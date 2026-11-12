import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { frameOf } from '../plan/geometry';
import type { Plan, Wall } from '../plan/types';
import type { PathPoint, Sun } from '../sg/solar';
import { buildFlat, type Built, type RoomAnchor } from './build';
import { PAL, col, makeUniforms } from './materials';
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
  s.scale.setScalar(strong ? 1.5 : 1.1);
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
  private u = makeUniforms();
  private tweens = new Tweens();
  private ray = new THREE.Raycaster();

  private sunLight = new THREE.DirectionalLight(0xffffff, 0);
  private hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  private fill = new THREE.DirectionalLight(0xffffff, 0.4);
  private bulbs: THREE.PointLight[] = [];
  private groundShadow: THREE.ShadowMaterial;

  private compass = new THREE.Group();
  private compassMats: { mat: THREE.Material & { opacity: number }; base: number }[] = [];
  private compassShow = 0;
  private sunSprite: THREE.Sprite;
  private sunCore: THREE.Mesh;
  private pathDots: THREE.Points;
  private hourDots: THREE.Points;
  private drop: THREE.Line;
  private domeR: number;

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
  private highlight: THREE.Group | null = null;
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
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

    this.built = buildFlat(plan, this.u, this.renderer.capabilities.getMaxAnisotropy());
    this.anchors = this.built.anchors;
    this.scene.add(this.built.root);
    this.nav = new Nav(plan, this.built.toWorld);

    const size = this.built.box.getSize(new THREE.Vector3());
    const radius = Math.hypot(size.x, size.z) / 2;
    this.domeR = radius + 0.9;
    this.target.set(0, this.built.height * 0.3, 0);

    // Light
    this.scene.add(this.hemi);
    this.fill.position.set(-6, 9, 7);
    this.scene.add(this.fill);
    const s = this.sunLight.shadow;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    s.mapSize.set(coarse ? 1536 : 2048, coarse ? 1536 : 2048);
    const ext = radius * 1.25;
    s.camera.left = -ext;
    s.camera.right = ext;
    s.camera.top = ext;
    s.camera.bottom = -ext;
    s.camera.near = 1;
    s.camera.far = 120;
    s.camera.updateProjectionMatrix();
    s.bias = -0.0005;
    s.normalBias = 0.03;
    this.sunLight.castShadow = true;
    this.scene.add(this.sunLight, this.sunLight.target);
    for (const p of this.built.lights) {
      const bulb = new THREE.PointLight(0xffd3a1, 0, 8.5, 1.5);
      bulb.position.copy(p);
      this.bulbs.push(bulb);
      this.scene.add(bulb);
    }

    this.groundShadow = new THREE.ShadowMaterial({ opacity: 0.16 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), this.groundShadow);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -BASE;
    ground.receiveShadow = true;
    this.scene.add(ground);

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
      const len = i % 18 === 0 ? 0.55 : i % 9 === 0 ? 0.32 : 0.14;
      tickPts.push(new THREE.Vector3(Math.sin(a) * this.domeR, 0, -Math.cos(a) * this.domeR));
      tickPts.push(new THREE.Vector3(Math.sin(a) * (this.domeR + len), 0, -Math.cos(a) * (this.domeR + len)));
    }
    this.compass.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tickPts), track(new THREE.LineBasicMaterial({ color: ink }), 0.5)));
    (['N', 'E', 'S', 'W'] as const).forEach((letter, i) => {
      const sp = letterSprite(letter, i === 0);
      const a = (i * Math.PI) / 2;
      sp.position.set(Math.sin(a) * (this.domeR + 1.25), 0.05, -Math.cos(a) * (this.domeR + 1.25));
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
    const toCam = new THREE.Vector3().setFromSphericalCoords(1, Math.max(phi, 0.0006), theta);
    const fwd = toCam.clone().negate();
    const right = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta));
    const up = new THREE.Vector3().crossVectors(right, fwd);
    const t = Math.tan((DOLL_FOV * DEG) / 2);
    const tanV = ((t * (this.h - this.pad)) / (this.h + this.pad)) * margin;
    const tanH = ((t * (this.w - this.padX)) / (this.h + this.pad)) * margin;
    const b = this.built.box;
    let d = 0;
    const c = new THREE.Vector3();
    for (const x of [b.min.x, b.max.x]) {
      for (const y of [-BASE, b.max.y]) {
        for (const z of [b.min.z, b.max.z]) {
          c.set(x, y, z).sub(this.target);
          const depth = c.dot(fwd);
          d = Math.max(d, Math.abs(c.dot(right)) / tanH - depth, Math.abs(c.dot(up)) / tanV - depth);
        }
      }
    }
    return d;
  }

  private setOrbit(theta: number, phi: number, dist: number): void {
    this.camera.position.setFromSphericalCoords(dist, Math.max(phi, 0.0006), theta).add(this.target);
    this.camera.up.copy(UP);
    this.camera.lookAt(this.target);
    this.dirty = true;
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
      const d = this.fit(this.dollAngles().theta, this.dollAngles().phi);
      this.controls.minDistance = d * 0.28;
      this.controls.maxDistance = d * 1.7;
    }
  }

  // ── Opening sequence ──────────────────────────────────────────────────────

  /** Draws the plan as lines, the state shown behind the welcome text. */
  showPlan(): Promise<void> {
    return this.tweens.run('draw', 1.6, (k) => (this.u.uDraw.value = k), { ease: ease.linear, delay: 0.25 });
  }

  /** Walls rise from the plan, finishes wash in, furniture arrives, daylight comes up. */
  async intro(bottom = 0): Promise<void> {
    this.introRunning = true;
    this.tweens.kill('draw');
    this.u.uDraw.value = 1;
    const from = this.planAngles();
    const to = this.dollAngles();
    const d0 = this.camera.position.distanceTo(this.target);
    const pad0 = this.pad;
    const padX0 = this.padX;
    this.pad = bottom;
    this.padX = 0;
    const d1 = this.fit(to.theta, to.phi);
    this.pad = pad0;
    this.padX = padX0;
    void this.tweens.run('rise', 1.8, (k) => (this.u.uRise.value = k), { ease: ease.linear });
    void this.tweens.run(
      'camera',
      2.6,
      (k) => {
        this.pad = lerp(pad0, bottom, k);
        this.padX = lerp(padX0, 0, k);
        this.applyView();
        this.setOrbit(lerp(from.theta, to.theta, k), lerp(from.phi, to.phi, k), lerp(d0, d1, k));
      },
      { ease: ease.inOutQuart, delay: 0.1 }
    );
    void this.tweens.run('reveal', 1.9, (k) => (this.u.uReveal.value = k), { ease: ease.inOut, delay: 0.6 });
    if (this.furnished) void this.tweens.run('pop', 1.6, (k) => (this.u.uPop.value = k), { ease: ease.linear, delay: 1.5 });
    await this.tweens.run(
      'gain',
      1.4,
      (k) => {
        this.sunGain = k;
        this.applyLight();
      },
      { ease: ease.out, delay: 2.0 }
    );
    (this.built.caps.material as THREE.Material).transparent = false;
    (this.built.caps.material as THREE.Material).needsUpdate = true;
    this.mode = 'doll';
    this.introRunning = false;
    this.controls.minDistance = d1 * 0.28;
    this.controls.maxDistance = d1 * 1.7;
    this.controls.enabled = true;
    this.controls.update();
    this.orbitLive = true;
    this.hooks.mode?.('doll');
  }

  /** Skips the opening sequence and lands on the finished model. For shared links and for tests. */
  jump(bottom = 0): void {
    for (const tag of ['draw', 'rise', 'camera', 'reveal', 'pop', 'gain']) this.tweens.kill(tag);
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
    (this.built.caps.material as THREE.Material).transparent = false;
    (this.built.caps.material as THREE.Material).needsUpdate = true;
    this.mode = 'doll';
    this.controls.minDistance = d * 0.28;
    this.controls.maxDistance = d * 1.7;
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
    if (this.mode === 'doll') this.reframe(lens === 'sun' ? 1.14 : 1);
  }

  private setCompass(k: number): void {
    this.compassShow = k;
    for (const { mat, base } of this.compassMats) mat.opacity = base * k;
    this.compass.visible = k > 0.01;
    this.placeSunMarker();
    this.dirty = true;
  }

  private reframe(scale: number): void {
    const off = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    const d0 = sph.radius;
    const d1 = this.fit(sph.theta, sph.phi) * scale;
    const t0 = this.controls.target.clone();
    this.orbitLive = false;
    void this.tweens
      .run('camera', 0.9, (k) => {
        this.target.lerpVectors(t0, new THREE.Vector3(0, this.built.height * 0.3, 0), k);
        this.setOrbit(sph.theta, sph.phi, lerp(d0, d1, k));
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
    for (const p of points) {
      if (p.altitude < -0.01) continue;
      const v = this.onDome(p);
      dots.push(v.x, v.y, v.z);
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

  private applyLight(): void {
    const { azimuth, altitude } = this.sun;
    const c = Math.cos(altitude);
    const dir = new THREE.Vector3(Math.sin(azimuth) * c, Math.sin(altitude), -Math.cos(azimuth) * c).applyAxisAngle(UP, this.bearing * DEG);
    const day = smooth(-4 * DEG, 7 * DEG, altitude);
    const gold = 1 - smooth(4 * DEG, 32 * DEG, altitude);

    this.sunLight.position.copy(this.target).addScaledVector(dir, 55);
    this.sunLight.target.position.copy(this.target);
    this.sunLight.intensity = 3.6 * smooth(-1 * DEG, 10 * DEG, altitude) * (1 - 0.22 * gold) * this.sunGain;
    this.sunLight.color.copy(col(0xfff2df)).lerp(col(0xff9248), Math.pow(gold, 1.6));

    const sky = col(0xf3f6fb).clone().lerp(col(0xfbe2cb), gold);
    this.hemi.color.copy(col(0x39446a)).lerp(sky, day);
    this.hemi.groundColor.copy(col(0x1b1e2a)).lerp(col(0xe9e1d3), day);
    this.hemi.intensity = lerp(0.5, 1.75, day);
    this.fill.intensity = 0.42 * day;
    const night = 1 - day;
    for (const b of this.bulbs) b.intensity = 26 * night * this.sunGain;
    (this.built.lamps.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.4 * night;
    this.groundShadow.opacity = 0.17 * smooth(1 * DEG, 22 * DEG, altitude) * this.sunGain;

    this.placeSunMarker();
    this.hooks.atmosphere?.(day, gold);
    this.shadowDirty = true;
    this.dirty = true;
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

  private tap(clientX: number, clientY: number): void {
    if (this.flying) return;
    this.aim(clientX, clientY);
    if (this.mode === 'walk') {
      const hitWall = this.ray.intersectObject(this.built.walls, false)[0];
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
      const hits = this.ray.intersectObjects([this.built.walls, this.built.caps], false);
      const hit = hits[0];
      if (!hit || hit.faceIndex == null) return this.select(null);
      const owner = hit.object === this.built.walls ? this.built.wallOfFace : this.built.capOfFace;
      const wall = this.plan.walls[owner[hit.faceIndex]];
      this.select(wall && wall.kind !== 'parapet' ? wall : null);
    }
  }

  /** Marks a wall as chosen and tells the interface. */
  select(wall: Wall | null): void {
    if (this.highlight) {
      this.scene.remove(this.highlight);
      this.highlight.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.highlight = null;
    }
    if (wall) {
      const f = frameOf(wall);
      const wh = (wall.h ?? this.plan.height) / 1000;
      const geo = new THREE.BoxGeometry((f.len + wall.t) / 1000 + 0.02, wh + 0.03, wall.t / 1000 + 0.05);
      const g = new THREE.Group();
      g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false })));
      g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x1c1d20 })));
      const [x, z] = this.built.toWorld((wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2);
      g.position.set(x, wh / 2, z);
      g.rotation.y = -Math.atan2(f.dy, f.dx);
      g.renderOrder = 4;
      this.scene.add(g);
      this.highlight = g;
    }
    this.dirty = true;
    this.hooks.wall?.(wall);
  }

  // ── Overlay support ───────────────────────────────────────────────────────

  /** Screen position of a point in the scene, in CSS pixels. */
  project(v: THREE.Vector3, out: { x: number; y: number; front: boolean }): void {
    const p = v.clone().project(this.camera);
    out.x = (p.x * 0.5 + 0.5) * this.w;
    out.y = (-p.y * 0.5 + 0.5) * this.h;
    out.front = p.z < 1;
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
    if (!this.dirty) return;
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
