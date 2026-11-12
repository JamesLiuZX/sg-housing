import * as THREE from 'three';
import { boundsOf, centroid, clearAreaSqm, frameOf, offsetPoly, openingsOf } from '../plan/geometry';
import type { Opening, Plan, Pt, Wall, WallKind } from '../plan/types';
import { bakeFloor, bakeGroundShadow } from './floorTexture';
import { furnish } from './furniture';
import { PAL, col, depthFor, floorMaterial, popMaterial, riseMaterial, type Uniforms } from './materials';
import { Kit } from './mesh';

export interface RoomAnchor {
  id: string;
  name: string;
  areaSqm: number;
  pos: THREE.Vector3;
}

export interface Built {
  root: THREE.Group;
  walls: THREE.Mesh;
  caps: THREE.Mesh;
  /** Wall above door heads and the ceiling: only seen from inside. */
  shell: THREE.Mesh[];
  furniture: THREE.Object3D[];
  lamps: THREE.Mesh;
  /** Triangle index → wall index, for picking. */
  wallOfFace: Int32Array;
  capOfFace: Int32Array;
  anchors: RoomAnchor[];
  lights: THREE.Vector3[];
  box: THREE.Box3;
  height: number;
  toWorld: (x: number, y: number) => [number, number];
  entry: THREE.Vector3;
  dispose: () => void;
}

const RULE_COLOUR: Record<WallKind, number> = {
  external: PAL.ruleNo,
  structural: PAL.ruleNo,
  shelter: PAL.ruleShelter,
  partition: PAL.ruleYes,
  parapet: PAL.capParapet
};

/** Hand-rolled quad buffer with the extra per-vertex data the wall shaders need. */
class Quads {
  pos: number[] = [];
  nor: number[] = [];
  rgb: number[] = [];
  rule: number[] = [];
  delay: number[] = [];
  idx: number[] = [];
  owner: number[] = [];

  quad(p: THREE.Vector3[], n: THREE.Vector3, colours: THREE.Color[], rule: THREE.Color, delay: number, owner: number): void {
    const base = this.pos.length / 3;
    // Keep the winding consistent with the stated normal so back faces cull correctly.
    const e1 = p[1].clone().sub(p[0]);
    const e2 = p[2].clone().sub(p[0]);
    const flip = e1.cross(e2).dot(n) < 0;
    const order = flip ? [0, 3, 2, 1] : [0, 1, 2, 3];
    for (const i of order) {
      this.pos.push(p[i].x, p[i].y, p[i].z);
      this.nor.push(n.x, n.y, n.z);
      this.rgb.push(colours[i].r, colours[i].g, colours[i].b);
      this.rule.push(rule.r, rule.g, rule.b);
      this.delay.push(delay);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.owner.push(owner, owner);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.rgb, 3));
    g.setAttribute('aRule', new THREE.Float32BufferAttribute(this.rule, 3));
    g.setAttribute('aDelay', new THREE.Float32BufferAttribute(this.delay, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

function capColour(wall: Wall, overWindow: boolean): number {
  if (wall.kind === 'parapet') return PAL.capParapet;
  if (overWindow) return PAL.capWindow;
  return wall.kind === 'partition' ? PAL.capPartition : PAL.capSolid;
}

function ruleColour(wall: Wall): number {
  if (wall.kind === 'partition' && wall.wet) return PAL.ruleWet;
  return RULE_COLOUR[wall.kind];
}

export function buildFlat(plan: Plan, u: Uniforms, maxAniso: number): Built {
  const b = boundsOf(plan);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const toWorld = (x: number, y: number): [number, number] => [(x - cx) / 1000, (y - cy) / 1000];
  const H = plan.height / 1000;
  const root = new THREE.Group();

  const reach = Math.max(...plan.outline.map((p) => Math.hypot(p[0] - plan.entry.x, p[1] - plan.entry.y)));
  const delayOf = (x: number, y: number) => Math.min(1, Math.hypot(x - plan.entry.x, y - plan.entry.y) / reach);

  // ── Walls ────────────────────────────────────────────────────────────────
  const wallQ = new Quads();
  const capQ = new Quads();
  const headQ = new Quads();
  const UP = new THREE.Vector3(0, 1, 0);
  const DOWN = new THREE.Vector3(0, -1, 0);
  const white = col(PAL.wall);
  const shaded = col(PAL.wallBase);

  plan.walls.forEach((wall, wi) => {
    const f = frameOf(wall);
    const wh = (wall.h ?? plan.height) / 1000;
    const half = wall.t / 2;
    const delay = delayOf((wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2);
    const rule = col(ruleColour(wall));
    const capLift = wall.kind === 'partition' ? 0 : wall.kind === 'shelter' ? 0.004 : 0.002;
    const at = (uu: number, v: number, y: number) => {
      const [x, z] = toWorld(wall.a[0] + f.dx * uu + f.nx * v, wall.a[1] + f.dy * uu + f.ny * v);
      return new THREE.Vector3(x, y, z);
    };
    const nIn = new THREE.Vector3(f.nx, 0, f.ny);
    const nOut = nIn.clone().negate();
    const dFwd = new THREE.Vector3(f.dx, 0, f.dy);
    const dBack = dFwd.clone().negate();

    const block = (u0: number, u1: number, y0: number, y1: number, into: Quads, capHex: number | null) => {
      const lo = y0 <= 0 ? -0.04 : y0;
      const cLo = y0 <= 0 ? shaded : white;
      const cs = [cLo, cLo, white, white];
      into.quad([at(u0, half, lo), at(u1, half, lo), at(u1, half, y1), at(u0, half, y1)], nIn, cs, rule, delay, wi);
      into.quad([at(u0, -half, lo), at(u1, -half, lo), at(u1, -half, y1), at(u0, -half, y1)], nOut, cs, rule, delay, wi);
      into.quad([at(u0, -half, lo), at(u0, half, lo), at(u0, half, y1), at(u0, -half, y1)], dBack, cs, rule, delay, wi);
      into.quad([at(u1, -half, lo), at(u1, half, lo), at(u1, half, y1), at(u1, -half, y1)], dFwd, cs, rule, delay, wi);
      if (y0 > 0) {
        into.quad([at(u0, -half, y0), at(u1, -half, y0), at(u1, half, y0), at(u0, half, y0)], DOWN, [white, white, white, white], rule, delay, wi);
      }
      const top = [at(u0, -half, y1), at(u1, -half, y1), at(u1, half, y1), at(u0, half, y1)];
      if (capHex === null) {
        into.quad(top, UP, [white, white, white, white], rule, delay, wi);
      } else {
        for (const p of top) p.y += capLift;
        const c = col(capHex);
        capQ.quad(top, UP, [c, c, c, c], wall.kind === 'parapet' ? c : rule, delay, wi);
      }
    };

    let cursor = -half;
    for (const o of openingsOf(plan, wall.id)) {
      if (o.at > cursor) block(cursor, o.at, 0, wh, wallQ, capColour(wall, false));
      const sill = (o.sill ?? 0) / 1000;
      const head = (o.head ?? plan.height) / 1000;
      if (o.type === 'window') {
        if (sill > 0) block(o.at, o.at + o.w, 0, sill, wallQ, null);
        if (head < wh) block(o.at, o.at + o.w, head, wh, wallQ, capColour(wall, true));
      } else if (o.type === 'door' && head < wh) {
        block(o.at, o.at + o.w, head, wh - 0.002, headQ, null);
      }
      cursor = o.at + o.w;
    }
    const end = f.len + half;
    if (end > cursor) block(cursor, end, 0, wh, wallQ, capColour(wall, false));
  });

  const wallMat = riseMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), u, { rule: 0.82 });
  const walls = new THREE.Mesh(wallQ.build(), wallMat);
  walls.castShadow = true;
  walls.receiveShadow = true;
  walls.customDepthMaterial = depthFor('rise', u);
  root.add(walls);

  const capMat = riseMaterial(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true }), u, { rule: 1, draw: true });
  const caps = new THREE.Mesh(capQ.build(), capMat);
  caps.renderOrder = 2;
  root.add(caps);

  const headMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, transparent: true, opacity: 0 });
  const heads = new THREE.Mesh(headQ.build(), headMat);
  heads.receiveShadow = true;
  heads.visible = false;
  root.add(heads);

  // ── Windows and doors ────────────────────────────────────────────────────
  const fit = new Kit();
  for (const wall of plan.walls) {
    const f = frameOf(wall);
    const theta = Math.atan2(f.dy, f.dx);
    for (const o of openingsOf(plan, wall.id)) {
      const [x, z] = toWorld(wall.a[0] + f.dx * o.at, wall.a[1] + f.dy * o.at);
      const w = o.w / 1000;
      const delay = delayOf(wall.a[0] + f.dx * (o.at + o.w / 2), wall.a[1] + f.dy * (o.at + o.w / 2));
      fit.place(x, z, -theta, delay, () => {
        if (o.type === 'window') windowUnit(fit, w, (o.sill ?? 0) / 1000, (o.head ?? plan.height) / 1000);
        else if (o.type === 'door') doorUnit(fit, o, w, wall.t / 1000);
      });
    }
  }
  const fitMat = riseMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }), u);
  const fittings = new THREE.Mesh(fit.solid.build(), fitMat);
  fittings.castShadow = true;
  fittings.receiveShadow = true;
  fittings.customDepthMaterial = depthFor('rise', u);
  root.add(fittings);

  const glassMat = riseMaterial(
    new THREE.MeshStandardMaterial({ color: PAL.glass, transparent: true, opacity: 0.26, roughness: 0.08, metalness: 0, depthWrite: false, side: THREE.DoubleSide }),
    u
  );
  const glass = new THREE.Mesh(fit.glass.build(), glassMat);
  glass.renderOrder = 3;
  root.add(glass);

  // ── Floor, base and ceiling ──────────────────────────────────────────────
  const bake = bakeFloor(plan);
  const tex = new THREE.CanvasTexture(bake.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  const [rx, rz] = toWorld(bake.minX, bake.minY);
  const rect = new THREE.Vector4(rx, rz, bake.sizeX / 1000, bake.sizeY / 1000);
  const [ex, ez] = toWorld(plan.entry.x, plan.entry.y);

  const outer = offsetPoly(plan.outline, -100);
  const slabPolys: Pt[][] = plan.slabs.map((s) => [
    [s.rect[0], s.rect[1]],
    [s.rect[2], s.rect[1]],
    [s.rect[2], s.rect[3]],
    [s.rect[0], s.rect[3]]
  ]);
  const floorPolys = [outer, ...slabPolys];

  const flat = (polys: Pt[][], y: number, up: boolean, grow = 0) => {
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (const src of polys) {
      const poly = grow ? offsetPoly(src, -grow) : src;
      const base = pos.length / 3;
      const pts = poly.map(([x, yy]) => new THREE.Vector2(x, yy));
      for (const [x, yy] of poly) {
        const [wx, wz] = toWorld(x, yy);
        pos.push(wx, y, wz);
        nor.push(0, up ? 1 : -1, 0);
        uv.push((wx - rect.x) / rect.z, 1 - (wz - rect.y) / rect.w);
      }
      for (const [a, b2, c] of THREE.ShapeUtils.triangulateShape(pts, [])) {
        // Wind each triangle to agree with its normal, whichever way the outline was drawn.
        const ax = poly[b2][0] - poly[a][0];
        const az = poly[b2][1] - poly[a][1];
        const bx = poly[c][0] - poly[a][0];
        const bz = poly[c][1] - poly[a][1];
        const ny = az * bx - ax * bz;
        if (ny > 0 === up) idx.push(base + a, base + b2, base + c);
        else idx.push(base + a, base + c, base + b2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  };

  const floorMat = floorMaterial(tex, u, rect, new THREE.Vector2(ex, ez), reach / 1000);
  floorMat.side = THREE.DoubleSide;
  const floor = new THREE.Mesh(flat(floorPolys, 0, true), floorMat);
  floor.receiveShadow = true;
  root.add(floor);

  // The slab edge, so the model sits on the table like a cut section.
  const BASE = 0.14;
  const edgeQ = new Quads();
  const edgeCol = col(PAL.slabEdge);
  for (const poly of floorPolys) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const [x0, z0] = toWorld(p[0], p[1]);
      const [x1, z1] = toWorld(q[0], q[1]);
      const n = new THREE.Vector3(q[1] - p[1], 0, -(q[0] - p[0])).normalize();
      edgeQ.quad(
        [new THREE.Vector3(x0, -BASE, z0), new THREE.Vector3(x1, -BASE, z1), new THREE.Vector3(x1, 0, z1), new THREE.Vector3(x0, 0, z0)],
        n,
        [edgeCol, edgeCol, edgeCol, edgeCol],
        edgeCol,
        0,
        -1
      );
    }
  }
  const edge = new THREE.Mesh(edgeQ.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
  edge.castShadow = true;
  root.add(edge);

  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0 });
  ceilMat.colorWrite = false;
  ceilMat.depthWrite = false;
  const ceiling = new THREE.Mesh(flat(floorPolys, H - 0.004, false, 60), ceilMat);
  ceiling.castShadow = true;
  root.add(ceiling);

  // Soft shadow on the table under the whole model.
  const gs = bakeGroundShadow(plan);
  const gTex = new THREE.CanvasTexture(gs.canvas);
  const [gx, gz] = toWorld(gs.minX + gs.sizeX / 2, gs.minY + gs.sizeY / 2);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(gs.sizeX / 1000, gs.sizeY / 1000),
    new THREE.MeshBasicMaterial({ map: gTex, transparent: true, depthWrite: false })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(gx, -BASE + 0.002, gz);
  ground.renderOrder = -1;
  root.add(ground);

  // ── Furniture ────────────────────────────────────────────────────────────
  const kit = new Kit();
  furnish(kit, plan.items, toWorld, delayOf);
  const furnMat = popMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }), u);
  const furn = new THREE.Mesh(kit.solid.build(), furnMat);
  furn.castShadow = true;
  furn.receiveShadow = true;
  furn.customDepthMaterial = depthFor('pop', u);
  root.add(furn);

  const furnGlass = new THREE.Mesh(
    kit.glass.build(),
    popMaterial(new THREE.MeshStandardMaterial({ color: PAL.glass, transparent: true, opacity: 0.3, roughness: 0.08, depthWrite: false, side: THREE.DoubleSide }), u)
  );
  furnGlass.renderOrder = 3;
  root.add(furnGlass);

  const lampMat = popMaterial(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, emissive: 0xffc27a, emissiveIntensity: 0 }),
    u
  );
  const lamps = new THREE.Mesh(kit.lamp.build(), lampMat);
  lamps.castShadow = true;
  lamps.customDepthMaterial = depthFor('pop', u);
  root.add(lamps);

  // ── Anchors ──────────────────────────────────────────────────────────────
  const anchors: RoomAnchor[] = plan.rooms
    .filter((r) => !r.quiet)
    .map((r) => {
      const [lx, ly] = r.label ?? centroid(r.poly);
      const [x, z] = toWorld(lx, ly);
      return { id: r.id, name: r.name, areaSqm: clearAreaSqm(plan, r), pos: new THREE.Vector3(x, 0.02, z) };
    });

  const lights = plan.lights.map(([lx, ly]) => {
    const [x, z] = toWorld(lx, ly);
    return new THREE.Vector3(x, H - 0.35, z);
  });

  const [bx0, bz0] = toWorld(b.minX, b.minY);
  const [bx1, bz1] = toWorld(b.maxX, b.maxY);
  const box = new THREE.Box3(new THREE.Vector3(bx0, 0, bz0), new THREE.Vector3(bx1, H, bz1));

  return {
    root,
    walls,
    caps,
    shell: [heads, ceiling],
    furniture: [furn, furnGlass, lamps],
    lamps,
    wallOfFace: Int32Array.from(wallQ.owner),
    capOfFace: Int32Array.from(capQ.owner),
    anchors,
    lights,
    box,
    height: H,
    toWorld,
    entry: new THREE.Vector3(ex, 0, ez),
    dispose() {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      tex.dispose();
      gTex.dispose();
    }
  };
}

/** A window in the frame of its wall: x along the wall from the opening's start, z across it. */
function windowUnit(k: Kit, w: number, sill: number, head: number): void {
  const p = 0.045;
  const dp = 0.07;
  const h = head - sill;
  k.box(w, p, dp, w / 2, sill, 0, PAL.frame, 0.004);
  k.box(w, p, dp, w / 2, head - p, 0, PAL.frame, 0.004);
  k.box(p, h, dp, p / 2, sill, 0, PAL.frame, 0.004);
  k.box(p, h, dp, w - p / 2, sill, 0, PAL.frame, 0.004);
  const panes = Math.max(1, Math.round(w / 0.62));
  for (let i = 1; i < panes; i++) k.box(p * 0.8, h, dp * 0.8, (w / panes) * i, sill, 0, PAL.frame, 0.004);
  if (h > 1.6) k.box(w, p * 0.8, dp * 0.8, w / 2, sill + 0.5, 0, PAL.frame, 0.004);
  k.box(w - p * 2, h - p * 2, 0.008, w / 2, sill + p, 0, PAL.glass, 0, undefined, 'glass');
}

/** A door leaf, drawn open, plus the gate for a main door. */
function doorUnit(k: Kit, o: Opening, w: number, t: number): void {
  const leafH = (o.head ?? 2100) / 1000 - 0.03;
  const into = o.into ?? 1;
  const hingeAtStart = (o.hinge ?? 'start') === 'start';
  const hx = hingeAtStart ? 0.01 : w - 0.01;
  const cx = hingeAtStart ? 1 : -1;
  const hz = into * (t / 2 - 0.025);
  const lw = w - 0.02;

  const leaf = (len: number, fromX: number, fromZ: number, deg: number, side: number, draw: (len: number) => void) => {
    const a = (deg * Math.PI) / 180;
    const dx = cx * Math.cos(a);
    const dz = side * Math.sin(a);
    k.sub(fromX + (dx * len) / 2, 0, fromZ + (dz * len) / 2, Math.atan2(-dz, dx), () => draw(len));
    return [fromX + dx * len, fromZ + dz * len] as const;
  };
  const handles = (len: number, hex: number) => {
    for (const s of [-1, 1]) k.box(0.13, 0.022, 0.03, len / 2 - 0.1, 1.0, s * 0.035, hex, 0.008);
  };

  switch (o.leaf) {
    case 'fold': {
      const [mx, mz] = leaf(lw / 2, hx, hz, 72, into, (len) => k.box(len, leafH, 0.03, 0, 0, 0, PAL.white, 0.004));
      leaf(lw / 2, mx, mz, 72, -into, (len) => k.box(len, leafH, 0.03, 0, 0, 0, PAL.white, 0.004));
      break;
    }
    case 'glass':
      leaf(lw, hx, hz, o.angle ?? 84, into, (len) => {
        const bar = 0.05;
        k.box(len, bar, 0.035, 0, 0, 0, PAL.frame, 0.004);
        k.box(len, bar, 0.035, 0, leafH - bar, 0, PAL.frame, 0.004);
        for (const s of [-1, 1]) k.box(bar, leafH, 0.035, s * (len / 2 - bar / 2), 0, 0, PAL.frame, 0.004);
        k.box(len - bar * 2, leafH - bar * 2, 0.008, 0, bar, 0, PAL.glass, 0, undefined, 'glass');
        handles(len, PAL.steel);
      });
      break;
    case 'steel':
      leaf(lw, hx, hz, o.angle ?? 24, into, (len) => {
        k.box(len, leafH, 0.07, 0, 0, 0, PAL.steel, 0.006);
        k.box(len - 0.12, leafH - 0.14, 0.076, 0, 0.07, 0, 0x979da3, 0.004);
        for (const y of [0.75, 1.25]) for (const s of [-1, 1]) k.box(0.2, 0.03, 0.035, len / 2 - 0.16, y, s * 0.052, PAL.steelDark, 0.008);
      });
      break;
    default: {
      const timber = o.leaf === 'timber';
      leaf(lw, hx, hz, o.angle ?? 82, into, (len) => {
        k.box(len, leafH, 0.042, 0, 0, 0, timber ? PAL.walnut : PAL.white, 0.005);
        if (timber) for (const y of [0.25, 1.1]) k.box(len - 0.2, 0.7, 0.048, 0, y, 0, 0x86654a, 0.004);
        handles(len, timber ? PAL.dark : PAL.steel);
      });
    }
  }

  if (o.gate) {
    leaf(lw, hx, -into * (t / 2 + 0.01), 112, -into, (len) => {
      const bar = 0.03;
      const gh = leafH - 0.02;
      k.box(len, bar, bar, 0, 0.02, 0, PAL.dark, 0.004);
      k.box(len, bar, bar, 0, gh - bar, 0, PAL.dark, 0.004);
      k.box(len, bar, bar, 0, gh * 0.48, 0, PAL.dark, 0.004);
      for (const s of [-1, 1]) k.box(bar, gh, bar, s * (len / 2 - bar / 2), 0.02, 0, PAL.dark, 0.004);
      const n = Math.round(len / 0.105);
      for (let i = 1; i < n; i++) k.box(0.012, gh, 0.012, -len / 2 + (len / n) * i, 0.02, 0, PAL.dark, 0.003);
      k.box(0.1, 0.16, 0.04, len / 2 - 0.08, 0.95, 0, PAL.steelDark, 0.006);
    });
  }
}
