import * as THREE from 'three';
import { boundsOf, centroid, clearAreaSqm, frameOf, offsetPoly, openingsOf, pointInPoly, solidSpans, wallOnEdge } from '../plan/geometry';
import type { Item, Opening, Plan, Pt, Wall, WallKind } from '../plan/types';
import { buildField, type LightField } from './field';
import { bakeFloor, bakeGroundShadow } from './floorTexture';
import { furnish } from './furniture';
import { PAL, col, depthFor, shade, tableMaterial, type Uniforms } from './materials';
import { Kit } from './mesh';

export interface RoomAnchor {
  id: string;
  name: string;
  areaSqm: number;
  pos: THREE.Vector3;
}

/** What the viewer needs to decide which walls to cut down for the camera. */
export interface WallCut {
  /** Centre of the wall and its left normal, world. */
  x: number;
  z: number;
  nx: number;
  nz: number;
  /** For walls on the outline, which side of the normal is outdoors (+1 or -1). 0 for walls inside. */
  out: number;
  /** Parapets are low already and stay as they are. */
  cuttable: boolean;
}

export interface WallHit {
  wall: number;
  distance: number;
  point: THREE.Vector3;
}

export interface Built {
  root: THREE.Group;
  caps: THREE.Mesh;
  /** Walls above door heads and the ceiling: seen only from inside, but always casting shadow. */
  shell: THREE.Mesh[];
  furniture: THREE.Object3D[];
  lamps: THREE.Mesh;
  anchors: RoomAnchor[];
  cuts: WallCut[];
  field: LightField;
  table: THREE.ShaderMaterial;
  /** World size of the table shadow image, metres. */
  tableSize: THREE.Vector2;
  box: THREE.Box3;
  height: number;
  /** Thickness of the slab the model stands on, metres. */
  base: number;
  toWorld: (x: number, y: number) => [number, number];
  entry: THREE.Vector3;
  /** The first wall a ray meets, given how tall each wall stands right now. */
  pick: (ray: THREE.Ray, top: (wall: number) => number) => WallHit | null;
  dispose: () => void;
}

const BASE = 0.14;

const RULE_COLOUR: Record<WallKind, number> = {
  external: PAL.ruleNo,
  structural: PAL.ruleNo,
  shelter: PAL.ruleShelter,
  partition: PAL.ruleYes,
  parapet: PAL.capParapet
};

/** How far each kind of section cap sits above its wall, so where walls overlap the stronger one is drawn. */
const CAP_LIFT: Record<WallKind, number> = { partition: 0.003, external: 0.005, structural: 0.005, shelter: 0.007, parapet: 0.002 };

/** Hand-rolled quad buffer with the extra per-vertex data the wall shaders need. */
class Quads {
  private pos: number[] = [];
  private nor: number[] = [];
  private rgb: number[] = [];
  private rule: number[] = [];
  private delay: number[] = [];
  private wall: number[] = [];
  private lift: number[] = [];
  private plan: number[] = [];
  private idx: number[] = [];

  quad(p: THREE.Vector3[], n: THREE.Vector3, c: THREE.Color, rule: THREE.Color, delay: number, wall: number, lift = 0, planOnly = 0): void {
    const base = this.pos.length / 3;
    // Keep the winding consistent with the stated normal so back faces cull correctly.
    const e1 = p[1].clone().sub(p[0]);
    const e2 = p[2].clone().sub(p[0]);
    const order = e1.cross(e2).dot(n) < 0 ? [0, 3, 2, 1] : [0, 1, 2, 3];
    for (const i of order) {
      this.pos.push(p[i].x, p[i].y, p[i].z);
      this.nor.push(n.x, n.y, n.z);
      this.rgb.push(c.r, c.g, c.b);
      this.rule.push(rule.r, rule.g, rule.b);
      this.delay.push(delay);
      this.wall.push(wall);
      this.lift.push(lift);
      this.plan.push(planOnly);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(caps = false): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.rgb, 3));
    g.setAttribute('aRule', new THREE.Float32BufferAttribute(this.rule, 3));
    g.setAttribute('aDelay', new THREE.Float32BufferAttribute(this.delay, 1));
    g.setAttribute('aWall', new THREE.Float32BufferAttribute(this.wall, 1));
    if (caps) {
      g.setAttribute('aLift', new THREE.Float32BufferAttribute(this.lift, 1));
      g.setAttribute('aPlan', new THREE.Float32BufferAttribute(this.plan, 1));
    }
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

  const field = buildField(plan, toWorld);
  u.uField.value = field.texture;
  u.uFieldRect.value.copy(field.rect);

  // ── Walls ────────────────────────────────────────────────────────────────
  const wallQ = new Quads();
  const capQ = new Quads();
  const headQ = new Quads();
  const UP = new THREE.Vector3(0, 1, 0);
  const DOWN = new THREE.Vector3(0, -1, 0);
  const white = col(PAL.wall);
  const planInk = col(PAL.planLine);

  plan.walls.forEach((wall, wi) => {
    const f = frameOf(wall);
    const wh = (wall.h ?? plan.height) / 1000;
    const half = wall.t / 2;
    const delay = delayOf((wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2);
    const rule = col(ruleColour(wall));
    const lift = CAP_LIFT[wall.kind];
    /** A point in the wall's frame: u along it from `a`, v across it toward the left normal, mm; y in metres. */
    const at = (uu: number, v: number, y: number) => {
      const [x, z] = toWorld(wall.a[0] + f.dx * uu + f.nx * v, wall.a[1] + f.dy * uu + f.ny * v);
      return new THREE.Vector3(x, y, z);
    };
    const nIn = new THREE.Vector3(f.nx, 0, f.ny);
    const nOut = nIn.clone().negate();
    const dFwd = new THREE.Vector3(f.dx, 0, f.dy);
    const dBack = dFwd.clone().negate();
    /** A flat mark lying on the cap or the floor: a strip from u0 to u1 between v0 and v1. */
    const mark = (u0: number, u1: number, v0: number, v1: number, y: number, c: THREE.Color, markLift: number, planOnly: number) =>
      capQ.quad([at(u0, v0, y), at(u1, v0, y), at(u1, v1, y), at(u0, v1, y)], UP, c, wall.kind === 'parapet' ? c : rule, delay, wi, markLift, planOnly);

    const block = (u0: number, u1: number, y0: number, y1: number, into: Quads, capHex: number | null) => {
      const lo = y0 <= 0 ? -0.04 : y0;
      into.quad([at(u0, half, lo), at(u1, half, lo), at(u1, half, y1), at(u0, half, y1)], nIn, white, rule, delay, wi);
      into.quad([at(u0, -half, lo), at(u1, -half, lo), at(u1, -half, y1), at(u0, -half, y1)], nOut, white, rule, delay, wi);
      into.quad([at(u0, -half, lo), at(u0, half, lo), at(u0, half, y1), at(u0, -half, y1)], dBack, white, rule, delay, wi);
      into.quad([at(u1, -half, lo), at(u1, half, lo), at(u1, half, y1), at(u1, -half, y1)], dFwd, white, rule, delay, wi);
      if (y0 > 0) into.quad([at(u0, -half, y0), at(u1, -half, y0), at(u1, half, y0), at(u0, half, y0)], DOWN, white, rule, delay, wi);
      if (capHex === null) into.quad([at(u0, -half, y1), at(u1, -half, y1), at(u1, half, y1), at(u0, half, y1)], UP, white, rule, delay, wi);
      else mark(u0, u1, -half, half, y1, col(capHex), lift, 0);
    };

    let cursor = -half;
    for (const o of openingsOf(plan, wall.id)) {
      if (o.at > cursor) block(cursor, o.at, 0, wh, wallQ, capColour(wall, false));
      const sill = (o.sill ?? 0) / 1000;
      const head = (o.head ?? plan.height) / 1000;
      if (o.type === 'window') {
        if (sill > 0) block(o.at, o.at + o.w, 0, sill, wallQ, null);
        if (head < wh) block(o.at, o.at + o.w, head, wh, wallQ, capColour(wall, true));
        // The glazing line of the plan symbol, kept on the cap.
        mark(o.at + 40, o.at + o.w - 40, -9, 9, wh, col(0x5f8293), lift + 0.0015, 0);
      } else if (o.type === 'door') {
        if (head < wh) block(o.at, o.at + o.w, head, wh - 0.002, headQ, null);
        doorSymbol(o, wall.t, (pts) => capQ.quad(pts.map(([uu, v]) => at(uu, v, 0)), UP, planInk, planInk, delay, wi, 0.004, 1));
      }
      cursor = o.at + o.w;
    }
    const end = f.len + half;
    if (end > cursor) block(cursor, end, 0, wh, wallQ, capColour(wall, false));
  });

  const walls = new THREE.Mesh(
    wallQ.build(),
    shade(new THREE.MeshLambertMaterial({ vertexColors: true }), u, { rise: true, fold: true, rule: 0.6, field: true, foot: 0.5, head: H, soft: true })
  );
  walls.castShadow = true;
  walls.receiveShadow = true;
  walls.customDepthMaterial = depthFor('rise', u);
  root.add(walls);

  const caps = new THREE.Mesh(capQ.build(true), shade(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true }), u, { rise: true, fold: true, cap: true, rule: 1 }));
  caps.renderOrder = 2;
  root.add(caps);

  // Door heads are hidden in the dollhouse so doorways read from above, but they always cast
  // their shadow: without it the sun would slip into a room over the top of every door.
  const heads = new THREE.Mesh(
    headQ.build(),
    shade(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0 }), u, { rise: true, fold: true, field: true, head: H, soft: true })
  );
  heads.castShadow = true;
  heads.receiveShadow = true;
  heads.customDepthMaterial = depthFor('rise', u);
  // Unseen until walking, and writing no depth either, or doorways would show holes from above.
  const headMat = heads.material as THREE.Material;
  headMat.colorWrite = false;
  headMat.depthWrite = false;
  root.add(heads);

  // ── Windows and doors ────────────────────────────────────────────────────
  const fit = new Kit();
  plan.walls.forEach((wall, wi) => {
    const f = frameOf(wall);
    const theta = Math.atan2(f.dy, f.dx);
    for (const o of openingsOf(plan, wall.id)) {
      const [x, z] = toWorld(wall.a[0] + f.dx * o.at, wall.a[1] + f.dy * o.at);
      const w = o.w / 1000;
      const delay = delayOf(wall.a[0] + f.dx * (o.at + o.w / 2), wall.a[1] + f.dy * (o.at + o.w / 2));
      fit.place(
        x,
        z,
        -theta,
        delay,
        () => {
          if (o.type === 'window') windowUnit(fit, w, (o.sill ?? 0) / 1000, (o.head ?? plan.height) / 1000);
          else if (o.type === 'door') doorUnit(fit, o, w, wall.t / 1000);
        },
        { wall: wi }
      );
    }
  });
  const fittings = new THREE.Mesh(
    fit.solid.build(),
    shade(new THREE.MeshLambertMaterial({ vertexColors: true }), u, { rise: true, fold: true, field: true, soft: true })
  );
  fittings.castShadow = true;
  fittings.receiveShadow = true;
  fittings.customDepthMaterial = depthFor('rise', u);
  root.add(fittings);

  const glass = new THREE.Mesh(
    fit.glass.build(),
    shade(new THREE.MeshLambertMaterial({ color: PAL.glass, transparent: true, depthWrite: false, side: THREE.DoubleSide }), u, { rise: true, fold: true, glass: true })
  );
  glass.renderOrder = 3;
  root.add(glass);

  // ── Floor, base and ceiling ──────────────────────────────────────────────
  const bake = bakeFloor(plan);
  const tex = new THREE.CanvasTexture(bake.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  const aoTex = new THREE.CanvasTexture(bake.ao);
  const [rx, rz] = toWorld(bake.minX, bake.minY);
  const rect = new THREE.Vector4(rx, rz, bake.sizeX / 1000, bake.sizeY / 1000);
  const [ex, ez] = toWorld(plan.entry.x, plan.entry.y);

  // The slab follows the outer face of each wall on the outline, however thick it is.
  const ring = plan.outline;
  const outer = offsetPoly(
    ring,
    ring.map((p, i) => -(wallOnEdge(plan, p, ring[(i + 1) % ring.length])?.t ?? 0) / 2)
  );
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

  const floorMat = shade(new THREE.MeshLambertMaterial({ map: tex }), u, {
    field: true,
    soft: true,
    reveal: { rect, origin: new THREE.Vector2(ex, ez), reach: reach / 1000 },
    contact: aoTex
  });
  const floor = new THREE.Mesh(flat(floorPolys, 0, true), floorMat);
  floor.receiveShadow = true;
  root.add(floor);

  // The slab edge, so the model sits on the table like a cut section.
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
        edgeCol,
        edgeCol,
        0,
        0
      );
    }
  }
  const edge = new THREE.Mesh(edgeQ.build(), shade(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), u, { soft: true }));
  edge.castShadow = true;
  edge.receiveShadow = true;
  root.add(edge);

  // The ceiling faces down, so from above it is culled before it costs anything; it still
  // casts from both sides, which is what keeps the sun to the windows.
  const ceilMat = shade(new THREE.MeshLambertMaterial({ color: 0xfbfaf6, transparent: true, opacity: 0 }), u, { field: true });
  ceilMat.colorWrite = false;
  ceilMat.depthWrite = false;
  ceilMat.shadowSide = THREE.DoubleSide;
  const ceiling = new THREE.Mesh(flat(floorPolys, H - 0.004, false, 60), ceilMat);
  ceiling.castShadow = true;
  root.add(ceiling);

  // Soft shadow on the table under the whole model.
  const gs = bakeGroundShadow(plan);
  const gTex = new THREE.CanvasTexture(gs.canvas);
  const [gx, gz] = toWorld(gs.minX + gs.sizeX / 2, gs.minY + gs.sizeY / 2);
  const table = tableMaterial(gTex);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gs.sizeX / 1000, gs.sizeY / 1000), table);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(gx, -BASE + 0.001, gz);
  ground.renderOrder = -1;
  root.add(ground);

  // ── Furniture ────────────────────────────────────────────────────────────
  const wallOf = (it: Item) => {
    let best = -1;
    let bestD = Infinity;
    plan.walls.forEach((w, i) => {
      const f = frameOf(w);
      const rx = it.x - w.a[0];
      const ry = it.y - w.a[1];
      const along = rx * f.dx + ry * f.dy;
      const off = Math.abs(rx * f.nx + ry * f.ny);
      if (along > -50 && along < f.len + 50 && off < bestD) {
        bestD = off;
        best = i;
      }
    });
    return best;
  };
  const kit = new Kit();
  furnish(kit, plan.items, toWorld, delayOf, wallOf);
  const furn = new THREE.Mesh(
    kit.solid.build(),
    shade(new THREE.MeshLambertMaterial({ vertexColors: true }), u, { pop: true, fold: true, field: true, foot: 0.14, soft: true })
  );
  furn.castShadow = true;
  furn.receiveShadow = true;
  furn.customDepthMaterial = depthFor('pop', u);
  root.add(furn);

  const furnGlass = new THREE.Mesh(
    kit.glass.build(),
    shade(new THREE.MeshLambertMaterial({ color: PAL.glass, transparent: true, depthWrite: false, side: THREE.DoubleSide }), u, { pop: true, glass: true })
  );
  furnGlass.renderOrder = 3;
  root.add(furnGlass);

  const lamps = new THREE.Mesh(
    kit.lamp.build(),
    shade(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xffc27a, emissiveIntensity: 0 }), u, { pop: true, field: true })
  );
  lamps.castShadow = true;
  lamps.customDepthMaterial = depthFor('pop', u);
  root.add(lamps);

  // ── Anchors and cuts ─────────────────────────────────────────────────────
  const anchors: RoomAnchor[] = plan.rooms
    .filter((r) => !r.quiet)
    .map((r) => {
      const [lx, ly] = r.label ?? centroid(r.poly);
      const [x, z] = toWorld(lx, ly);
      return { id: r.id, name: r.name, areaSqm: clearAreaSqm(plan, r), pos: new THREE.Vector3(x, 0.02, z) };
    });

  const cuts: WallCut[] = plan.walls.map((w) => {
    const f = frameOf(w);
    const mx = (w.a[0] + w.b[0]) / 2;
    const my = (w.a[1] + w.b[1]) / 2;
    const probe = w.t / 2 + 250;
    const left = pointInPoly(mx + f.nx * probe, my + f.ny * probe, plan.outline);
    const right = pointInPoly(mx - f.nx * probe, my - f.ny * probe, plan.outline);
    const [x, z] = toWorld(mx, my);
    return { x, z, nx: f.nx, nz: f.ny, out: left && right ? 0 : left ? -1 : 1, cuttable: w.kind !== 'parapet' && (left || right) };
  });

  // Picking works on the plan rather than the meshes, so a cut wall is only as tall as it is drawn.
  const solid = plan.walls.map((w) => ({ w, f: frameOf(w), spans: solidSpans(plan, w), h: (w.h ?? plan.height) / 1000 }));
  const pick = (ray: THREE.Ray, top: (wall: number) => number): WallHit | null => {
    let best: WallHit | null = null;
    solid.forEach(({ w, f, spans, h }, i) => {
      const [ax, az] = toWorld(w.a[0], w.a[1]);
      const ox = ray.origin.x - ax;
      const oz = ray.origin.z - az;
      // The ray in the wall's own frame: along, across, up.
      const o = [(ox * f.dx + oz * f.dy) * 1000, (ox * f.nx + oz * f.ny) * 1000, ray.origin.y];
      const d = [(ray.direction.x * f.dx + ray.direction.z * f.dy) * 1000, (ray.direction.x * f.nx + ray.direction.z * f.ny) * 1000, ray.direction.y];
      const hi = Math.min(h, top(i));
      for (const [u0, u1] of spans) {
        const lo3 = [u0, -w.t / 2, 0];
        const hi3 = [u1, w.t / 2, hi];
        let t0 = 0;
        let t1 = Infinity;
        for (let k = 0; k < 3; k++) {
          if (Math.abs(d[k]) < 1e-9) {
            if (o[k] < lo3[k] || o[k] > hi3[k]) t1 = -1;
            continue;
          }
          const ta = (lo3[k] - o[k]) / d[k];
          const tb = (hi3[k] - o[k]) / d[k];
          t0 = Math.max(t0, Math.min(ta, tb));
          t1 = Math.min(t1, Math.max(ta, tb));
        }
        if (t1 >= t0 && t0 > 0 && (!best || t0 < best.distance)) best = { wall: i, distance: t0, point: ray.at(t0, new THREE.Vector3()) };
      }
    });
    return best;
  };

  const [bx0, bz0] = toWorld(b.minX, b.minY);
  const [bx1, bz1] = toWorld(b.maxX, b.maxY);
  const box = new THREE.Box3(new THREE.Vector3(bx0, 0, bz0), new THREE.Vector3(bx1, H, bz1));

  return {
    root,
    caps,
    shell: [heads, ceiling],
    furniture: [furn, furnGlass, lamps],
    lamps,
    anchors,
    cuts,
    field,
    table,
    tableSize: new THREE.Vector2(gs.sizeX / 1000, gs.sizeY / 1000),
    box,
    height: H,
    base: BASE,
    toWorld,
    entry: new THREE.Vector3(ex, 0, ez),
    pick,
    dispose() {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
        if (mesh.customDepthMaterial) mesh.customDepthMaterial.dispose();
      });
      tex.dispose();
      aoTex.dispose();
      gTex.dispose();
      field.dispose();
    }
  };
}

/**
 * The plan symbol of a door, drawn flat in the wall's frame (u along, v across,
 * mm): the leaf standing open at a right angle and the arc it sweeps. Folding
 * doors are drawn as their two leaves.
 */
function doorSymbol(o: Opening, t: number, quad: (pts: [number, number][]) => void): void {
  const into = o.into ?? 1;
  const startHinge = (o.hinge ?? 'start') === 'start';
  const hu = startHinge ? o.at : o.at + o.w;
  const sweep = startHinge ? 1 : -1;
  const hv = into * (t / 2);
  const line = (u0: number, v0: number, u1: number, v1: number, w: number) => {
    const du = u1 - u0;
    const dv = v1 - v0;
    const len = Math.hypot(du, dv) || 1;
    const pu = (-dv / len) * (w / 2);
    const pv = (du / len) * (w / 2);
    quad([
      [u0 + pu, v0 + pv],
      [u1 + pu, v1 + pv],
      [u1 - pu, v1 - pv],
      [u0 - pu, v0 - pv]
    ]);
  };
  if (o.leaf === 'fold') {
    const a = (72 * Math.PI) / 180;
    const half = o.w / 2;
    const mu = hu + sweep * Math.cos(a) * half;
    const mv = hv + into * Math.sin(a) * half;
    line(hu, hv, mu, mv, 30);
    line(mu, mv, hu + sweep * 2 * Math.cos(a) * half, hv, 30);
    return;
  }
  const r = o.w;
  line(hu, hv, hu, hv + into * r, 36);
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * (Math.PI / 2);
    const a1 = ((i + 1) / steps) * (Math.PI / 2);
    const p = (a: number, rr: number): [number, number] => [hu + sweep * Math.cos(a) * rr, hv + into * Math.sin(a) * rr];
    quad([p(a0, r - 11), p(a1, r - 11), p(a1, r + 11), p(a0, r + 11)]);
  }
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
