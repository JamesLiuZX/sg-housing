import type { Item } from '../plan/types';
import { PAL } from './materials';
import type { Kit, LeafSpec, PlaceOptions, Vec3 } from './mesh';

const HALF = Math.PI / 2;
const turn = { S: 0, E: HALF, N: Math.PI, W: -HALF } as const;
/** The plan direction each piece's front looks, which is its local +z. */
const FRONT = { S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0] } as const;
/** The golden angle, radians: leaves set this far apart round a stem never stack. */
const GOLDEN = 2.39996;

/** What a piece needs to know about the rest of the flat. */
interface Setting {
  /** The counter the rice cooker and kettle stand on: a plain run if the kitchen has one, else the hob's. */
  appliances: Item | null;
}

type Maker = (k: Kit, it: Item, set: Setting) => void;

const m = (mm: number | undefined, fallback: number) => (mm ?? fallback) / 1000;
const opt = (it: Item, key: string) => it.opts?.[key];
const num = (it: Item, key: string): number | null => {
  const v = opt(it, key);
  return typeof v === 'number' ? v : null;
};
/** A fixed scatter in [-1, 1], so the same flat always grows the same leaves. */
const wobble = (i: number) => (((i * 7919 + 17) % 23) / 11 - 1);

/**
 * Tones the palette does not name, each one step from the palette colour it
 * is made from, so the model keeps to its few colours.
 */
const TONE = {
  /** Walnut, darker: potting soil. */
  soil: 0x5b4535,
  /** Leaf, deeper: older leaves low on a plant, and stalks. */
  leafDeep: 0x4f7a55,
  /** Leaf, paler: the underside of every leaf. */
  leafPale: 0x9fb994,
  /** Sage, lighter: the daybed's cushions. */
  sageLight: 0xa7b5a2,
  /** Near black: a television's glass and a glass hob. */
  screen: 0x17181b,
  hob: 0x1c1d20,
  /** Steel, pale: a fridge's body and doors, and a washer's door glass. */
  appliance: 0xdfe1e2,
  applianceDoor: 0xe9ebec,
  porthole: 0x35404a,
  /** The field inside a rug's border. */
  rugField: 0xdfe2e4,
  rugFieldWarm: 0xe3d3c0
} as const;

/** Half-widths of leaves from stalk to tip, as fractions of the widest. */
const LEAF = {
  /** Fiddle-leaf fig: narrow at the stalk, a waist, then a broad rounded head. */
  fiddle: [0.1, 0.4, 0.62, 0.7, 0.67, 0.86, 0.96, 0.84, 0.48, 0],
  /** Long and pointed: aglaonema, the kind kept by a front door. */
  lance: [0.12, 0.58, 0.9, 1, 0.92, 0.7, 0.4, 0],
  /** Snake plant: a stiff blade, almost parallel-sided. */
  sword: [0.66, 0.92, 1, 0.94, 0.74, 0.38, 0],
  /** Pothos: a heart, broadest near the stalk. */
  heart: [0.6, 0.96, 1, 0.84, 0.58, 0.28, 0],
  /** A herb's small leaf. */
  small: [0.3, 0.9, 1, 0.62, 0]
} as const;

type Profile = readonly (readonly [number, number])[];

/** A dinner plate: a foot, a rim, a shallow well. Radius and height, metres. */
const PLATE: Profile = [[0, 0], [0.075, 0], [0.12, 0.016], [0.108, 0.019], [0, 0.008]];
/** A wide shallow fruit bowl. */
const BOWL: Profile = [[0, 0], [0.06, 0], [0.135, 0.065], [0.128, 0.07], [0.055, 0.012], [0, 0.012]];
/** A vessel basin standing on a vanity top. */
const BASIN: Profile = [[0, 0], [0.11, 0], [0.16, 0.05], [0.178, 0.12], [0.17, 0.126], [0.148, 0.07], [0.09, 0.032], [0, 0.027]];
/** A toilet pan from the floor: foot, bowl, rim, then down the inside to the water. Stretched front to back when used. */
const PAN: Profile = [[0, 0], [0.1, 0], [0.105, 0.05], [0.115, 0.2], [0.165, 0.33], [0.178, 0.385], [0.17, 0.395], [0.13, 0.36], [0.07, 0.29], [0, 0.275]];
/** A coffee table's tulip base. */
const PEDESTAL: Profile = [[0, 0], [0.2, 0], [0.205, 0.008], [0.19, 0.02], [0.065, 0.06], [0.042, 0.12], [0.04, 0.27], [0.07, 0.335], [0.15, 0.36], [0, 0.36]];
/** A dome pendant shade, closed underneath by its diffuser. */
const DOME: Profile = [[0, 0.004], [0.205, 0.004], [0.235, 0], [0.228, 0.035], [0.19, 0.11], [0.12, 0.175], [0.05, 0.208], [0, 0.212]];
/** A tapered drum lampshade. */
const DRUM: Profile = [[0, 0], [0.182, 0], [0.186, 0.006], [0.15, 0.28], [0.146, 0.286], [0, 0.286]];
/** A bedside lamp's ceramic base. */
const JAR: Profile = [[0, 0], [0.045, 0], [0.062, 0.05], [0.066, 0.1], [0.045, 0.155], [0.014, 0.175], [0, 0.175]];
/** A reading lamp's shade, closed at its mouth. */
const CONE: Profile = [[0, 0], [0.068, 0], [0.066, 0.012], [0.04, 0.09], [0.016, 0.11], [0, 0.112]];

/** Where along a polyline of points a height falls, by straight steps: good enough to set a stalk on a trunk. */
function along(pts: readonly Vec3[], y: number): [number, number] {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (y <= b[1] || i === pts.length - 1) {
      const t = Math.min(1, Math.max(0, (y - a[1]) / (b[1] - a[1] || 1)));
      return [a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t];
    }
  }
  return [pts[0][0], pts[0][2]];
}

// ── Plants ─────────────────────────────────────────────────────────────────

/**
 * A plant pot, turned, with a rolled lip, and soil inside; returns the height
 * of the soil. `full` adds a flared lip and an eased foot, for a pot big
 * enough to show them.
 */
function pot(k: Kit, x: number, y0: number, z: number, r: number, h: number, hex: number, seg = 14, full = false): number {
  const lip = Math.min(0.014, r * 0.12);
  const profile: Profile = full
    ? [[0, 0], [r * 0.78, 0], [r * 0.82, 0.007], [r * 0.96, h - lip], [r, h - lip * 0.4], [r, h], [r - lip * 0.8, h], [r - lip, h - 0.03], [0, h - 0.03]]
    : [[0, 0], [r * 0.8, 0], [r, h], [r - lip, h], [r - lip, h - 0.03], [0, h - 0.03]];
  k.lathe(profile, x, y0, z, hex, seg);
  k.cyl(r - lip, r - lip, 0.006, x, y0 + h - 0.028, z, TONE.soil, Math.max(10, seg - 4));
  return y0 + h - 0.022;
}

/**
 * A fiddle-leaf fig in a tall white pot by the window: a slim trunk with
 * broad leaves spiralling up it, held high so the crown stays within the
 * pot's own footprint, newer and paler at the top.
 */
function fig(k: Kit, reach: number): void {
  const s = Math.min(1, reach / 0.25);
  const soil = pot(k, 0, 0, 0, 0.19 * s, 0.42, PAL.white, 22, true);
  const trunk: Vec3[] = [
    [0, soil - 0.03, 0],
    [0.014, 0.72, 0.008],
    [-0.01, 1.06, -0.008],
    [0.006, 1.4, 0.006],
    [0, 1.7, 0]
  ];
  k.tube(trunk, 0.016, 0.006, PAL.walnut, 6, 14);
  const n = 22;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const y = 0.84 + t * 0.82;
    const [tx, tz] = along(trunk, y);
    const yaw = i * GOLDEN + 0.6;
    const stalk = 0.03;
    const sp = 0.9;
    const bx = tx + Math.sin(yaw) * Math.cos(sp) * stalk;
    const by = y + Math.sin(sp) * stalk;
    const bz = tz + Math.cos(yaw) * Math.cos(sp) * stalk;
    k.rod([tx, y, tz], [bx, by, bz], 0.0045, 0.003, TONE.leafDeep, 4);
    const len = (0.25 - 0.07 * t) * s;
    const spec: LeafSpec = { len, width: len * 0.62, outline: LEAF.fiddle, yaw, pitch: 0.78 + 0.5 * t, curl: 0.62 - 0.2 * t, cup: 0.16, roll: wobble(i) * 0.25 };
    k.leaf(bx, by, bz, spec, t > 0.78 ? PAL.leafLight : t > 0.3 ? PAL.leaf : TONE.leafDeep, TONE.leafPale);
  }
}

/** An aglaonema in a clay pot, the kind kept by a front door: long leaves arching out from the middle. */
function bush(k: Kit, reach: number): void {
  const s = Math.min(1.2, reach / 0.21);
  const soil = pot(k, 0, 0, 0, 0.13 * s, 0.26, PAL.terracotta, 16);
  const n = 13;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const yaw = i * GOLDEN;
    const rise = 0.09 + 0.12 * (((i * 5) % 7) / 6);
    const out = (0.02 + 0.03 * t) * s;
    const sx = Math.sin(yaw) * out;
    const sz = Math.cos(yaw) * out;
    k.rod([sx * 0.3, soil - 0.01, sz * 0.3], [sx, soil + rise, sz], 0.0042, 0.0035, TONE.leafDeep, 4);
    const len = 0.17 * s;
    const spec: LeafSpec = { len, width: len * 0.4, outline: LEAF.lance, yaw, pitch: 0.95 - 0.35 * t, curl: 1, cup: 0.22, roll: wobble(i) * 0.2 };
    k.leaf(sx, soil + rise, sz, spec, i % 3 === 0 ? PAL.sageDark : PAL.leaf, TONE.leafPale);
  }
}

/** A snake plant in a small pot: stiff blades standing up, each a little twisted. */
function snake(k: Kit, x: number, y0: number, z: number): void {
  const soil = pot(k, x, y0, z, 0.062, 0.13, PAL.cream, 14);
  const blades: [number, number][] = [
    [0.44, 0.2],
    [0.36, 2.4],
    [0.4, 4.3],
    [0.3, 1.2],
    [0.34, 3.4],
    [0.27, 5.4]
  ];
  blades.forEach(([len, yaw], i) => {
    const r = 0.016;
    const spec: LeafSpec = { len, width: 0.05, outline: LEAF.sword, yaw, pitch: 1.42 - i * 0.04, curl: 0.12, cup: 0.25, roll: 0.5 + i * 0.6 };
    k.leaf(x + Math.sin(yaw) * r, soil - 0.012, z + Math.cos(yaw) * r, spec, i % 2 ? PAL.sageDark : TONE.leafDeep, TONE.leafPale);
  });
}

/**
 * A pothos in a small pot: `heap` heart-shaped leaves heaped on it, and a
 * vine trailing toward +z, over the edge it stands near and `drop` metres
 * down the face below, which lies at `face`.
 */
function pothos(k: Kit, x: number, y0: number, z: number, face: number, drop: number, heap = 6): void {
  const soil = pot(k, x, y0, z, 0.058, 0.1, PAL.cream, 12);
  for (let i = 0; i < heap; i++) {
    const yaw = i * GOLDEN + 0.4;
    const spec: LeafSpec = { len: 0.075, width: 0.06, outline: LEAF.heart, yaw, pitch: 0.75 - (i % 3) * 0.2, curl: 0.6, cup: 0.2, roll: wobble(i) * 0.3 };
    k.leaf(x + Math.sin(yaw) * 0.015, soil + 0.012 + (i % 2) * 0.02, z + Math.cos(yaw) * 0.015, spec, i % 2 ? PAL.leafLight : PAL.leaf, TONE.leafPale);
  }
  // The vine leaves the pot, runs to the edge and hangs down just proud of the face
  // below, with its leaves lying almost flat against it.
  const hang = face + 0.004;
  const vine: Vec3[] = [
    [x + 0.02, soil + 0.01, z + 0.04],
    [x + 0.03, y0 + 0.015, (z + hang) / 2 + 0.02],
    [x + 0.035, y0 + 0.004, hang],
    [x + 0.028, y0 - drop, hang]
  ];
  k.tube(vine, 0.003, 0.0025, TONE.leafDeep, 4, 10);
  for (let i = 0; i < 3; i++) {
    const t = (i + 0.8) / 3;
    const spec: LeafSpec = { len: 0.06, width: 0.05, outline: LEAF.heart, yaw: (i % 2 ? 1 : -1) * 0.25, pitch: -1.45, curl: 0.1, cup: 0.08 };
    k.leaf(x + 0.032 + (i % 2 ? 0.012 : -0.012), y0 - 0.03 - t * (drop - 0.04), face + 0.002, spec, i % 2 ? PAL.leaf : PAL.leafLight, TONE.leafPale);
  }
}

/** A chilli plant in a clay pot by the yard window: small pointed leaves, and three chillies ripening upward. */
function chilli(k: Kit, x: number, y0: number, z: number): void {
  const soil = pot(k, x, y0, z, 0.05, 0.09, PAL.terracotta, 12);
  k.rod([x, soil - 0.01, z], [x + 0.005, soil + 0.13, z - 0.004], 0.0042, 0.0025, PAL.sageDark, 4);
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const yaw = i * GOLDEN;
    const spec: LeafSpec = { len: 0.055 - 0.015 * t, width: 0.026, outline: LEAF.small, yaw, pitch: 0.3 + 0.5 * t, curl: 0.5, cup: 0.2 };
    k.leaf(x + 0.004 * t, soil + 0.03 + t * 0.09, z, spec, t > 0.7 ? PAL.leafLight : PAL.leaf, TONE.leafPale);
  }
  const fruit: Vec3[] = [
    [0.02, 0.06, 0.012],
    [-0.018, 0.08, 0.014],
    [0.006, 0.1, -0.02]
  ];
  for (const [dx, dy, dz] of fruit) k.rod([x + dx, soil + dy, z + dz], [x + dx * 1.5, soil + dy + 0.034, z + dz * 1.5], 0.0045, 0.0012, PAL.orange, 5);
}

// ── Small things ───────────────────────────────────────────────────────────

const SPINES = [PAL.ink, PAL.cream, PAL.sageDark, PAL.linen, PAL.walnut, PAL.inkLight, PAL.white, PAL.orange];

/** A row of books standing on y0 from x0 to the right, filling at most `room` metres; returns the width used. */
function books(k: Kit, x0: number, y0: number, z: number, room: number, seed: number, depth = 0.15): number {
  let x = x0;
  for (let i = 0; ; i++) {
    const w = 0.022 + ((seed * (i + 3) * 7) % 5) * 0.006;
    if (x + w - x0 > room) break;
    const h = 0.19 + ((seed * (i + 1) * 13) % 6) * 0.017;
    const d = depth - ((i * seed) % 3) * 0.012;
    k.box(w, h, d, x + w / 2, y0, z - (depth - d) / 2, SPINES[(seed + i * 3) % SPINES.length], 0.002);
    x += w + 0.002;
  }
  return x - x0;
}

/** A few books lying in a stack, each turned a little against the one below. */
function stack(k: Kit, x: number, y0: number, z: number, n: number, seed: number, yaw = 0): void {
  let y = y0;
  for (let i = 0; i < n; i++) {
    const w = 0.22 - ((seed + i) % 3) * 0.025;
    const t = 0.022 + ((seed * (i + 2)) % 3) * 0.008;
    k.box(w, t, w * 0.72, x, y, z, SPINES[(seed * 3 + i * 5) % SPINES.length], 0.003, [0, yaw + wobble(seed + i) * 0.18, 0]);
    y += t;
  }
}

/**
 * A dining or desk chair at x, z facing `rot`: a slim upholstered seat,
 * tapered round legs, braced low, and a back raked and curved to whoever
 * sits in it. It keeps within 0.2 of its centre either side, 0.23 behind.
 */
function chair(k: Kit, x: number, z: number, rot: number, seat: number = PAL.linen, frame: number = PAL.oak): void {
  k.sub(x, 0, z, rot, () => {
    const s = 0.45;
    for (const sx of [-1, 1]) {
      k.rod([sx * 0.178, 0, 0.172], [sx * 0.165, s - 0.04, 0.155], 0.0095, 0.0145, frame);
      k.rod([sx * 0.172, 0, -0.2], [sx * 0.165, s - 0.04, -0.163], 0.0095, 0.0145, frame);
      k.rod([sx * 0.165, s - 0.04, -0.163], [sx * 0.16, 0.83, -0.196], 0.0145, 0.011, frame);
      k.rod([sx * 0.172, 0.16, 0.165], [sx * 0.169, 0.16, -0.188], 0.0055, 0.0055, frame, 6);
    }
    k.box(0.36, 0.03, 0.34, 0, s - 0.065, -0.004, frame, 0.006);
    k.soft(0.4, 0.04, 0.39, 0, s - 0.04, 0, seat, [0.3, 0.18], undefined, 12, 0.12);
    k.bent(0.36, 0.075, 0.016, 0.7, 0, 0.715, -0.188, frame, [-0.12, 0, 0]);
  });
}

/** A round upholstered stool on three splayed legs, for a dressing table. */
function stool(k: Kit, x: number, z: number): void {
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    k.rod([x + Math.sin(a) * 0.165, 0, z + Math.cos(a) * 0.165], [x + Math.sin(a) * 0.115, 0.39, z + Math.cos(a) * 0.115], 0.009, 0.014, PAL.oak, 6);
  }
  k.cyl(0.15, 0.15, 0.022, x, 0.385, z, PAL.oak, 20);
  k.soft(0.35, 0.07, 0.35, x, 0.4, z, PAL.fabricLight, [0.4, 1], undefined, 16, 0.12);
}

/**
 * A cushion standing on y0, w wide, h tall and t thick at its middle,
 * leaning back by `lean` and turned by `yaw`. It is made lying flat, the way
 * the soft solid pinches its seam, then stood up.
 */
function cushion(k: Kit, x: number, y0: number, z: number, w: number, h: number, t: number, hex: number, lean: number, yaw = 0): void {
  k.sub(x, y0 + h / 2, z, yaw, () => k.soft(w, t, h, 0, -t / 2, 0, hex, [1.25, 0.3], [HALF - lean, 0, 0], 14, 0.1));
}

type Shoe = 'sneaker' | 'slipper' | 'school';

/** A pair of shoes side by side on y0, toes toward +z of the frame turned by `yaw`. */
function pair(k: Kit, x: number, y0: number, z: number, hex: number, kind: Shoe, size = 1, yaw = 0): void {
  k.sub(x, y0, z, yaw, () => {
    for (const s of [-1, 1]) {
      k.sub(s * 0.052 * size, 0, 0, s * 0.06, () => {
        if (kind === 'slipper') {
          k.soft(0.09 * size, 0.018, 0.24 * size, 0, 0, 0, hex, [0.35, 0.7], undefined, 8, 0.08);
          k.soft(0.094 * size, 0.034, 0.07 * size, 0, 0.012, 0.05 * size, hex, [0.6, 0.4], undefined, 8, 0.04);
        } else {
          k.box(0.092 * size, 0.022, 0.255 * size, 0, 0, 0, PAL.white, 0);
          k.soft(0.084 * size, 0.075 * size, 0.2 * size, 0, 0.012, -0.022 * size, kind === 'school' ? PAL.white : hex, [0.6, 0.55], undefined, 8, 0.14);
        }
      });
    }
  });
}

/** A mug, with its handle to +x. */
function mug(k: Kit, x: number, y0: number, z: number, hex: number): void {
  k.lathe([[0, 0], [0.036, 0], [0.04, 0.088], [0.035, 0.088], [0.033, 0.012], [0, 0.012]], x, y0, z, hex, 14);
  k.tube([[x + 0.038, y0 + 0.07, z], [x + 0.062, y0 + 0.062, z], [x + 0.062, y0 + 0.03, z], [x + 0.038, y0 + 0.022, z]], 0.006, 0.006, hex, 5, 6);
}

/** A laptop open on y0, its screen toward +z of the frame turned by `yaw`. */
function laptop(k: Kit, x: number, y0: number, z: number, yaw: number): void {
  k.sub(x, y0, z, yaw, () => {
    k.box(0.32, 0.012, 0.22, 0, 0, 0, PAL.steel, 0.004);
    k.box(0.28, 0.002, 0.1, 0, 0.012, 0.025, PAL.steelDark, 0);
    k.frame(0, 0.012, -0.106, [-0.3, 0, 0], () => {
      k.box(0.32, 0.21, 0.008, 0, 0, 0, PAL.steel, 0.003);
      k.box(0.3, 0.19, 0.002, 0, 0.01, 0.005, TONE.screen, 0);
    });
  });
}

/** A reading lamp on y0: a weighted base, two slim arms, a shade looking down and forward toward +z. */
function readingLamp(k: Kit, x: number, y0: number, z: number, yaw: number, shade: number): void {
  k.sub(x, y0, z, yaw, () => {
    k.cyl(0.058, 0.064, 0.016, 0, 0, 0, PAL.dark, 18);
    k.rod([0, 0.016, 0], [0.015, 0.3, -0.04], 0.006, 0.006, PAL.dark, 6);
    k.rod([0.015, 0.3, -0.04], [0.015, 0.42, 0.11], 0.005, 0.005, PAL.dark, 6);
    k.frame(0.015, 0.42, 0.11, [0.85, 0, 0], () => k.lathe(CONE, 0, -0.112, 0, shade, 16, 'lamp'));
  });
}

/**
 * A desk fan on y0 looking toward +z: a round foot, a stem, the motor, and
 * a guard drawn as a faint glass dome over three blades, which is how a
 * wire cage reads at this size.
 */
function deskFan(k: Kit, x: number, y0: number, z: number, yaw: number): void {
  k.sub(x, y0, z, yaw, () => {
    k.lathe([[0, 0], [0.085, 0], [0.08, 0.018], [0.03, 0.03], [0, 0.03]], 0, 0, 0, PAL.white, 14);
    k.rod([0, 0.03, 0], [0, 0.24, 0], 0.012, 0.01, PAL.white, 8);
    k.soft(0.075, 0.075, 0.1, 0, 0.21, -0.025, PAL.white, [1, 1], undefined, 8, 0.08);
    k.frame(0, 0.248, 0.04, [HALF, 0, 0], () => {
      for (let i = 0; i < 3; i++) k.frame(0, 0, 0, [0, (i / 3) * Math.PI * 2, 0], () => k.soft(0.05, 0.004, 0.105, 0, -0.002, 0.062, PAL.inkLight, [0.6, 0.9], [0, 0, 0.35], 8, 0));
      k.cyl(0.02, 0.02, 0.03, 0, -0.015, 0, PAL.white, 12);
      k.lathe([[0, -0.028], [0.12, -0.028], [0.145, -0.01], [0.145, 0.012], [0.12, 0.03], [0, 0.03]], 0, 0, 0, PAL.glass, 18, 'glass');
      k.lathe([[0.139, -0.008], [0.152, -0.008], [0.152, 0.01], [0.139, 0.01], [0.139, -0.008]], 0, 0, 0, PAL.white, 18);
    });
  });
}

/**
 * A school bag standing on the floor, facing +z of the frame turned by
 * `yaw`: a soft body, a front pocket, a grab loop and its straps.
 */
function schoolBag(k: Kit, x: number, z: number, yaw: number): void {
  k.sub(x, 0, z, yaw, () =>
    k.frame(0, 0, 0, [-0.12, 0, 0], () => {
      k.soft(0.28, 0.38, 0.13, 0, 0, 0, PAL.ink, [0.45, 0.35], undefined, 14, 0.18);
      k.soft(0.22, 0.17, 0.05, 0, 0.05, 0.07, PAL.ink, [0.5, 0.4], undefined, 10, 0.1);
      k.box(0.012, 0.03, 0.01, 0.06, 0.2, 0.097, PAL.orange, 0.004);
      k.tube([[-0.04, 0.37, -0.02], [-0.03, 0.42, -0.02], [0.03, 0.42, -0.02], [0.04, 0.37, -0.02]], 0.007, 0.007, PAL.ink, 5, 8);
      for (const sx of [-0.07, 0.07]) k.soft(0.05, 0.28, 0.022, sx, 0.06, -0.072, PAL.ink, [0.5, 0.4], undefined, 8, 0.1);
    })
  );
}

/** A rice cooker on y0: a rounded white body, a domed lid with its handle, and the button panel at the front. */
function riceCooker(k: Kit, x: number, y0: number, z: number): void {
  k.lathe([[0, 0], [0.112, 0], [0.128, 0.016], [0.134, 0.11], [0.126, 0.15], [0, 0.15]], x, y0, z, PAL.white, 18);
  k.lathe([[0, 0], [0.126, 0], [0.12, 0.03], [0.085, 0.062], [0.03, 0.074], [0, 0.075]], x, y0 + 0.15, z, PAL.white, 18);
  k.cyl(0.016, 0.018, 0.014, x - 0.04, y0 + 0.21, z - 0.03, PAL.steelDark, 10);
  k.box(0.08, 0.055, 0.03, x, y0 + 0.05, z + 0.12, PAL.steelDark, 0.008);
  k.tube([[x - 0.07, y0 + 0.16, z + 0.02], [x - 0.05, y0 + 0.24, z + 0.02], [x + 0.05, y0 + 0.24, z + 0.02], [x + 0.07, y0 + 0.16, z + 0.02]], 0.009, 0.009, PAL.steel, 6, 10);
}

/** An electric jug kettle on its base, spout toward +z. */
function kettle(k: Kit, x: number, y0: number, z: number): void {
  k.cyl(0.082, 0.088, 0.02, x, y0, z, PAL.dark, 18);
  k.lathe([[0, 0], [0.078, 0], [0.083, 0.012], [0.072, 0.19], [0.058, 0.205], [0, 0.207]], x, y0 + 0.02, z, PAL.steel, 16);
  k.cyl(0.014, 0.016, 0.014, x, y0 + 0.226, z, PAL.dark, 10);
  k.tube([[x, y0 + 0.2, z - 0.06], [x, y0 + 0.2, z - 0.115], [x, y0 + 0.08, z - 0.12], [x, y0 + 0.06, z - 0.075]], 0.011, 0.011, PAL.dark, 6, 10);
  k.rod([x, y0 + 0.17, z + 0.06], [x, y0 + 0.215, z + 0.11], 0.016, 0.008, PAL.steel, 8);
}

/** A chopping board with a knife on it. */
function board(k: Kit, x: number, y0: number, z: number): void {
  k.box(0.38, 0.022, 0.25, x, y0, z, PAL.oak, 0.008, [0, 0.06, 0]);
  k.box(0.2, 0.004, 0.03, x + 0.03, y0 + 0.022, z + 0.05, PAL.steel, 0, [0, 0.5, 0]);
  k.box(0.09, 0.014, 0.024, x - 0.09, y0 + 0.022, z + 0.11, PAL.dark, 0.005, [0, 0.5, 0]);
}

/** A wok on the hob, its timber handle toward the front: the pan every HDB kitchen cooks in. */
function wok(k: Kit, x: number, y0: number, z: number): void {
  k.lathe([[0, 0], [0.06, 0], [0.155, 0.055], [0.172, 0.082], [0.166, 0.085], [0.148, 0.062], [0.055, 0.007], [0, 0.007]], x, y0, z, PAL.dark, 18);
  k.rod([x + 0.02, y0 + 0.075, z + 0.165], [x + 0.06, y0 + 0.1, z + 0.27], 0.012, 0.014, PAL.walnut, 6);
}

/** A crock of cooking spoons, and the soy sauce and oil beside it. */
function crock(k: Kit, x: number, y0: number, z: number): void {
  k.cyl(0.05, 0.046, 0.14, x - 0.04, y0, z, PAL.cream, 14);
  k.rod([x - 0.05, y0 + 0.05, z], [x - 0.07, y0 + 0.3, z - 0.01], 0.006, 0.006, PAL.walnut, 5);
  k.rod([x - 0.03, y0 + 0.05, z], [x - 0.02, y0 + 0.28, z + 0.015], 0.005, 0.005, PAL.steel, 5);
  k.box(0.05, 0.07, 0.006, x - 0.017, y0 + 0.27, z + 0.017, PAL.steel, 0, [0, 0, -0.06]);
  k.lathe([[0, 0], [0.028, 0], [0.03, 0.12], [0.012, 0.16], [0.011, 0.19], [0, 0.19]], x + 0.05, y0, z - 0.02, PAL.dark, 10);
  k.lathe([[0, 0], [0.026, 0], [0.028, 0.15], [0.01, 0.19], [0.009, 0.215], [0, 0.215]], x + 0.1, y0, z + 0.02, PAL.sageDark, 10);
}

/** Three canisters of what gets used every day. */
function canisters(k: Kit, x: number, y0: number, z: number): void {
  k.cyl(0.045, 0.045, 0.17, x - 0.06, y0, z, PAL.cream, 14);
  k.cyl(0.045, 0.045, 0.13, x + 0.04, y0, z, PAL.steel, 14);
  k.cyl(0.035, 0.035, 0.2, x + 0.06, y0, z - 0.085, PAL.terracotta, 14);
}

/** A dish rack by the sink, with plates standing in it and a cup turned over to dry. */
function dishRack(k: Kit, x: number, y0: number, z: number): void {
  k.box(0.3, 0.02, 0.26, x, y0, z, PAL.steel, 0.006);
  for (const sx of [-1, 1]) k.box(0.3, 0.09, 0.006, x, y0 + 0.02, z + sx * 0.125, PAL.steel, 0);
  // A cylinder turned on its side has its middle at y0 + h / 2 before it turns, hence the offset.
  for (let i = 0; i < 4; i++) k.cyl(0.095, 0.095, 0.012, x - 0.1 + i * 0.04, y0 + 0.02 + 0.095 - 0.006, z, PAL.white, 18, [0, 0, HALF]);
  k.lathe([[0, 0], [0.038, 0], [0.033, 0.08], [0.028, 0.085], [0, 0.085]], x + 0.09, y0 + 0.02, z + 0.06, PAL.cream, 12);
}

/** Washing-up liquid and a sponge. */
function soap(k: Kit, x: number, y0: number, z: number): void {
  k.lathe([[0, 0], [0.03, 0], [0.032, 0.14], [0.012, 0.17], [0.01, 0.2], [0, 0.2]], x, y0, z, PAL.sageDark, 12);
  k.box(0.09, 0.03, 0.06, x + 0.06, y0, z + 0.05, PAL.cream, 0.008, [0, 0.4, 0]);
}

/** Things set out along a counter or shelf: how wide each is, and how to draw it at its centre. */
interface Thing {
  w: number;
  draw: (x: number) => void;
}

/**
 * Sets things out left to right in the free stretches between `lo` and `hi`,
 * skipping the `busy` stretches (a hob, a sink): each goes in the first
 * stretch with room left. Whatever fits nowhere is left off rather than
 * crowded in.
 */
function setOut(lo: number, hi: number, busy: [number, number][], things: Thing[], gap = 0.05): void {
  const free: [number, number][] = [];
  let from = lo;
  for (const [a, b] of [...busy].sort((p, q) => p[0] - q[0])) {
    if (a > from) free.push([from, Math.min(a, hi)]);
    from = Math.max(from, b);
  }
  if (hi > from) free.push([from, hi]);
  const cursor = free.map(([a]) => a);
  for (const t of things) {
    const i = free.findIndex(([, b], j) => cursor[j] + t.w <= b);
    if (i < 0) continue;
    t.draw(cursor[i] + t.w / 2);
    cursor[i] += t.w + gap;
  }
}

// ── Laundry ────────────────────────────────────────────────────────────────

/** A T-shirt on a wire hanger hooked over a pole at height y, running along x. */
function shirt(k: Kit, x: number, y: number, z: number, hex: number): void {
  k.tube([[x, y - 0.03, z], [x, y - 0.005, z + 0.017], [x, y + 0.027, z], [x, y + 0.008, z - 0.017]], 0.0025, 0.0025, PAL.steel, 4, 8);
  k.rod([x - 0.2, y - 0.08, z], [x, y - 0.03, z], 0.003, 0.003, PAL.steel, 4);
  k.rod([x, y - 0.03, z], [x + 0.2, y - 0.08, z], 0.003, 0.003, PAL.steel, 4);
  k.box(0.38, 0.5, 0.012, x, y - 0.58, z, hex, 0.004);
  for (const s of [-1, 1]) k.box(0.16, 0.15, 0.012, x + s * 0.245, y - 0.235, z, hex, 0.004, [0, 0, -s * 0.6]);
}

/** A towel folded over a pole at height y. */
function towel(k: Kit, x: number, y: number, z: number, w: number, drop: number, hex: number): void {
  k.cyl(0.014, 0.014, w, x, y - w / 2, z, hex, 10, [0, 0, HALF]);
  for (const s of [-1, 1]) k.box(w, drop, 0.006, x, y - drop, z + s * 0.011, hex, 0.003);
}

/** A pair of shorts pegged by the waist to a pole at height y. */
function shorts(k: Kit, x: number, y: number, z: number, hex: number): void {
  k.box(0.34, 0.13, 0.014, x, y - 0.14, z, hex, 0.004);
  for (const s of [-1, 1]) {
    k.box(0.16, 0.25, 0.014, x + s * 0.088, y - 0.38, z, hex, 0.004, [0, 0, -s * 0.07]);
    k.box(0.012, 0.045, 0.02, x + s * 0.15, y - 0.03, z, PAL.cream, 0.004);
  }
}

// ── The pieces ─────────────────────────────────────────────────────────────

const makers: Record<string, Maker> = {
  sofa(k, it) {
    const w = m(it.w, 2200);
    const d = m(it.d, 920);
    const daybed = !!opt(it, 'daybed');
    const body = daybed ? PAL.sage : PAL.fabric;
    const fill = daybed ? TONE.sageLight : PAL.fabricLight;
    const legH = 0.1;
    const arm = 0.15;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) k.rod([sx * (w / 2 - 0.07), 0, sz * (d / 2 - 0.07)], [sx * (w / 2 - 0.085), legH + 0.01, sz * (d / 2 - 0.085)], 0.009, 0.015, PAL.walnut);
    }
    // The upholstered frame: a deck, a back and two arms, all softly rounded.
    k.box(w - 0.02, 0.16, d - 0.02, 0, legH, 0, body, 0.025);
    k.soft(w - 0.03, 0.42, 0.16, 0, legH + 0.12, -d / 2 + 0.09, body, [0.25, 0.1], undefined, 12, 0.1);
    for (const sx of [-1, 1]) k.soft(arm, 0.4, d - 0.02, sx * (w / 2 - arm / 2 - 0.01), legH + 0.08, 0, body, [0.3, 0.14], undefined, 12, 0.12);
    // Seat and back cushions, the backs raked against the frame and sunk into the seats.
    const inner = w - 2 * arm - 0.04;
    const n = inner > 1.45 ? 3 : 2;
    const cw = inner / n;
    for (let i = 0; i < n; i++) {
      const cx = -inner / 2 + cw * (i + 0.5);
      k.soft(cw - 0.012, 0.15, d - 0.19, cx, legH + 0.15, 0.085, fill, [0.3, 0.14], undefined, 16, 0.14);
      k.soft(cw - 0.025, 0.42, 0.15, cx, 0.36, -d / 2 + 0.25, fill, [0.45, 0.2], [-0.22, 0, 0], 12, 0.12);
    }
    // Two cushions thrown in the corners: the orange accent, and one quieter.
    cushion(k, -inner / 2 + 0.27, 0.38, -d / 2 + 0.36, 0.42, 0.42, 0.13, PAL.orange, 0.3, 0.32);
    cushion(k, inner / 2 - 0.25, 0.38, -d / 2 + 0.36, 0.38, 0.38, 0.12, daybed ? PAL.cream : PAL.ink, 0.32, -0.26);
  },

  bed(k, it) {
    const w = m(it.w, 1520);
    const l = m(it.d, 2000);
    const alt = !!opt(it, 'tone');
    const legH = 0.1;
    // The headboard stands at the back of the footprint; the frame runs up to it.
    const back = -l / 2 - 0.09;
    const boardT = alt ? 0.04 : 0.025;
    const frame0 = back + boardT;
    const frame1 = l / 2 + 0.025;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const z = sz < 0 ? frame0 + 0.1 : frame1 - 0.1;
      k.rod([sx * (w / 2 - 0.07), 0, z], [sx * (w / 2 - 0.07), legH + 0.01, z], 0.02, 0.024, PAL.walnut, 8);
    }
    k.box(w + 0.07, 0.19, frame1 - frame0, 0, legH, (frame0 + frame1) / 2, PAL.oak, 0.018);
    k.box(w - 0.01, 0.2, l - 0.03, 0, 0.29, 0.01, PAL.white, 0.03);
    // A duvet over the lower two thirds, hanging over the sides and the foot, with the top sheet turned down over it.
    const dl = l * 0.7;
    const dz = l / 2 - dl / 2 + 0.012;
    k.soft(w + 0.055, 0.135, dl, 0, 0.42, dz, alt ? PAL.inkLight : PAL.linen, [0.28, 0.08], undefined, 16, 0.1);
    k.soft(w + 0.06, 0.05, 0.22, 0, 0.5, dz - dl / 2 + 0.09, PAL.white, [0.5, 0.1], undefined, 16, 0.1);
    // Pillows propped toward the headboard; a double bed has two, and a small cushion in front.
    const two = w > 1.3;
    const pw = two ? Math.min(0.64, w / 2 - 0.06) : Math.min(0.64, w - 0.24);
    for (const px of two ? [-w / 4, w / 4] : [0]) cushion(k, px, 0.4, -l / 2 + 0.24, pw, 0.42, 0.16, PAL.white, 1.2);
    if (two) cushion(k, 0, 0.47, -l / 2 + 0.47, 0.44, 0.3, 0.12, PAL.orange, 0.5);
    // A throw folded across the foot, its ends hanging over both sides.
    const tz = l / 2 - 0.3;
    const throwHex = alt ? PAL.cream : PAL.sage;
    k.box(w + 0.07, 0.02, 0.42, 0, 0.553, tz, throwHex, 0.008);
    for (const sx of [-1, 1]) k.box(0.012, 0.15, 0.42, sx * (w / 2 + 0.039), 0.415, tz, throwHex, 0.005);
    // Headboard: a timber panel for a child's bed, an upholstered channelled one for the main bed.
    const hw = w + 0.11;
    if (alt) {
      k.box(hw, 0.86, boardT, 0, 0.12, back + boardT / 2, PAL.oakLight, 0.018);
    } else {
      k.box(hw, 1.0, boardT, 0, 0.06, back + boardT / 2, PAL.oak, 0.01);
      const n = Math.max(4, Math.round(hw / 0.2));
      const cw = hw / n;
      for (let i = 0; i < n; i++) k.soft(cw - 0.006, 0.74, 0.06, -hw / 2 + cw * (i + 0.5), 0.3, back + boardT + 0.03, PAL.fabricLight, [0.14, 0.55], undefined, 10, 0.08);
    }
  },

  sideTable(k, it) {
    const w = m(it.w, 450);
    const d = m(it.d, 420);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.rod([sx * (w / 2 - 0.035), 0, sz * (d / 2 - 0.035)], [sx * (w / 2 - 0.042), 0.13, sz * (d / 2 - 0.042)], 0.009, 0.013, PAL.walnut, 6);
    k.box(w, 0.34, d - 0.01, 0, 0.12, -0.005, PAL.oak, 0.012);
    k.box(w - 0.05, 0.12, 0.008, 0, 0.3, d / 2 - 0.014, PAL.oakLight, 0.003);
    k.box(0.05, 0.01, 0.008, 0, 0.395, d / 2 - 0.006, PAL.walnut, 0);
    // A lamp and a book.
    k.lathe(JAR, -0.04, 0.46, -0.03, PAL.cream, 14);
    k.rod([-0.04, 0.63, -0.03], [-0.04, 0.7, -0.03], 0.006, 0.006, PAL.dark, 6);
    k.frame(-0.04, 0.69, -0.03, [0, 0, 0], () => k.lathe(DRUM, 0, 0, 0, PAL.cream, 18, 'lamp'), [0.62, 0.6, 0.62]);
    stack(k, w / 2 - 0.12, 0.46, d / 2 - 0.13, 1, 5, 0.3);
  },

  wardrobe(k, it) {
    const w = m(it.w, 1500);
    const d = m(it.d, 600);
    const h = 2.32;
    k.box(w, 0.07, d - 0.06, 0, 0, -0.03, PAL.dark, 0.004);
    k.box(w, h - 0.07, d - 0.03, 0, 0.07, -0.015, PAL.white, 0.006);
    const n = Math.max(2, Math.round(w / 0.5));
    const dw = w / n;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + dw * (i + 0.5);
      k.box(dw - 0.006, h - 0.085, 0.02, x, 0.077, d / 2 - 0.02, i % 2 ? PAL.oakLight : PAL.white, 0.005);
      k.box(0.012, 0.3, 0.008, x + (i % 2 ? -1 : 1) * (dw / 2 - 0.04), 1.0, d / 2 - 0.005, PAL.walnut, 0.004);
    }
  },

  desk(k, it) {
    const w = m(it.w, 1200);
    const d = m(it.d, 600);
    const vanity = !!opt(it, 'vanity');
    k.box(w, 0.03, d, 0, 0.72, 0, PAL.oak, 0.01);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const a: Vec3 = [sx * (w / 2 - 0.045), 0, sz * (d / 2 - 0.045)];
        k.rod(a, [sx * (w / 2 - 0.05), 0.72, sz * (d / 2 - 0.05)], vanity ? 0.012 : 0.011, vanity ? 0.017 : 0.013, vanity ? PAL.oak : PAL.dark, 8);
      }
    }
    const top = 0.75;
    if (vanity) {
      // A dressing table: a round mirror on the wall, a tray, two bottles, a stool.
      k.hang(0, 1.15, -d / 2, () => {
        k.cyl(0.215, 0.215, 0.012, 0, 1.15 - 0.006, -d / 2 + 0.006, PAL.oak, 32, [HALF, 0, 0]);
        k.cyl(0.2, 0.2, 0.008, 0, 1.15 - 0.004, -d / 2 + 0.016, PAL.mirror, 32, [HALF, 0, 0]);
      });
      k.box(0.22, 0.014, 0.12, w / 2 - 0.2, top, -0.02, PAL.oakLight, 0.004);
      k.lathe([[0, 0], [0.026, 0], [0.03, 0.06], [0.012, 0.075], [0.012, 0.09], [0, 0.09]], w / 2 - 0.26, top + 0.014, -0.03, PAL.terracotta, 12);
      k.lathe([[0, 0], [0.022, 0], [0.022, 0.05], [0.008, 0.06], [0.008, 0.07], [0, 0.07]], w / 2 - 0.16, top + 0.014, -0.01, PAL.cream, 12);
      stool(k, 0, d / 2 + 0.16);
      return;
    }
    // A study desk. A wider one is for work, with a laptop and a fan; a narrower one is a child's, with a school bag by it.
    const work = w >= 1.2;
    if (work) {
      laptop(k, -0.06, top, 0.02, 0);
      deskFan(k, w / 2 - 0.15, top, -d / 2 + 0.14, -0.5);
    } else {
      stack(k, -0.05, top, 0.0, 2, 2, 0.15);
      schoolBag(k, -w / 2 + 0.215, d / 2 - 0.12, 0);
    }
    books(k, -w / 2 + 0.06, top, -d / 2 + 0.1, 0.2, work ? 3 : 4);
    readingLamp(k, w / 2 - (work ? 0.34 : 0.14), top, -d / 2 + 0.12, -0.3, work ? PAL.orange : PAL.cream);
    mug(k, w / 2 - 0.2, top, 0.1, work ? PAL.white : PAL.sage);
    chair(k, 0.02, d / 2 + 0.13, Math.PI, PAL.fabric);
  },

  diningSet(k, it) {
    const w = m(it.w, 1600);
    const d = m(it.d, 850);
    const top = 0.745;
    k.box(w, 0.032, d, 0, top - 0.032, 0, PAL.oak, 0.01);
    k.box(w - 0.22, 0.075, d - 0.2, 0, top - 0.105, 0, PAL.oak, 0.006);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) k.rod([sx * (w / 2 - 0.07), 0, sz * (d / 2 - 0.065)], [sx * (w / 2 - 0.1), top - 0.03, sz * (d / 2 - 0.09)], 0.015, 0.024, PAL.oak, 10);
    }
    // Three a side when the table is long enough, two otherwise; set clear of the legs.
    const q = Math.min(0.465, w / 2 - 0.335);
    const xs = w >= 1.5 ? [-q, 0, q] : [-Math.min(0.34, w / 4), Math.min(0.34, w / 4)];
    for (const cx of xs) {
      for (const s of [-1, 1]) {
        chair(k, cx, s * (d / 2 + 0.09), s > 0 ? Math.PI : 0);
        k.lathe(PLATE, cx, top, s * (d / 2 - 0.19), PAL.white, 12);
        k.box(0.1, 0.008, 0.15, cx + 0.185, top, s * (d / 2 - 0.19), PAL.linen, 0);
      }
    }
    // A bowl of oranges in the middle.
    k.lathe(BOWL, 0, top, 0, PAL.cream, 20);
    const fruit: [number, number, number][] = [
      [0.045, 0.045, 0.03],
      [-0.05, 0.045, 0.02],
      [0, 0.045, -0.05],
      [0.005, 0.1, 0]
    ];
    for (const [x, y, z] of fruit) k.soft(0.084, 0.08, 0.084, x, top + y - 0.04, z, PAL.orange, [1, 1], undefined, 10, 0.12);
  },

  pendant(k) {
    k.rod([0, 2.58, 0], [0, 1.87, 0], 0.003, 0.003, PAL.dark, 4);
    k.cyl(0.05, 0.05, 0.02, 0, 2.58, 0, PAL.dark, 14);
    k.lathe(DOME, 0, 1.66, 0, PAL.cream, 24, 'lamp');
  },

  tvConsole(k, it) {
    const w = m(it.w, 1800);
    const d = m(it.d, 450);
    const legH = 0.12;
    const topY = legH + 0.36;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) k.rod([sx * (w / 2 - 0.07), 0, sz * (d / 2 - 0.06)], [sx * (w / 2 - 0.085), legH + 0.01, sz * (d / 2 - 0.075)], 0.01, 0.015, PAL.walnut, 8);
    }
    k.box(w, 0.36, d - 0.02, 0, legH, -0.01, PAL.oak, 0.012);
    const n = 3;
    const dw = w / n;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + dw * (i + 0.5);
      k.box(dw - 0.006, 0.33, 0.012, x, legH + 0.015, d / 2 - 0.016, PAL.oakLight, 0.004);
      k.box(dw * 0.35, 0.012, 0.006, x, topY - 0.045, d / 2 - 0.007, PAL.walnut, 0);
    }
    // On top: a soundbar, a few books, a snake plant.
    k.soft(Math.min(0.86, w * 0.48), 0.06, 0.09, 0, topY, -0.03, PAL.dark, [0.3, 0.25], undefined, 12, 0.1);
    stack(k, -w / 2 + 0.2, topY, 0.03, 3, 1, -0.1);
    snake(k, w / 2 - 0.17, topY, 0.02);
    // The television hangs on the wall above, and goes with that wall when it is cut away.
    k.hang(0, 1.26, -d / 2, () => {
      k.box(1.32, 0.76, 0.03, 0, 0.88, -d / 2 + 0.02, PAL.dark, 0.008);
      k.box(1.3, 0.74, 0.004, 0, 0.89, -d / 2 + 0.036, TONE.screen, 0);
    });
  },

  coffeeTable(k, it) {
    const r = m(it.w, 800) / 2;
    k.lathe(PEDESTAL, 0, 0, 0, PAL.dark, 18);
    k.lathe([[0, 0], [r - 0.015, 0], [r, 0.01], [r, 0.02], [r - 0.012, 0.032], [0, 0.032]], 0, 0.36, 0, PAL.oak, 30);
    const top = 0.392;
    stack(k, -0.12, top, 0.08, 2, 6, 0.5);
    // A small vase with a cutting in it, and a cup.
    k.lathe([[0, 0], [0.03, 0], [0.042, 0.05], [0.03, 0.11], [0.015, 0.14], [0.018, 0.15], [0, 0.15]], 0.13, top, -0.1, PAL.cream, 12);
    for (let i = 0; i < 3; i++) {
      const yaw = i * GOLDEN + 1;
      const spec: LeafSpec = { len: 0.09, width: 0.04, outline: LEAF.lance, yaw, pitch: 0.9 - i * 0.2, curl: 0.7, cup: 0.2 };
      k.leaf(0.13, top + 0.15 + i * 0.03, -0.1, spec, i % 2 ? PAL.leaf : PAL.leafLight, TONE.leafPale);
    }
    k.rod([0.13, top + 0.12, -0.1], [0.132, top + 0.22, -0.098], 0.0025, 0.002, TONE.leafDeep, 4);
    k.lathe([[0, 0], [0.032, 0], [0.036, 0.065], [0.031, 0.065], [0.029, 0.01], [0, 0.01]], 0.16, top, 0.12, PAL.white, 12);
  },

  rug(k, it) {
    const w = m(it.w, 1700);
    const d = m(it.d, 2300);
    const alt = !!opt(it, 'tone');
    k.box(w, 0.008, d, 0, 0.002, 0, alt ? PAL.terracotta : PAL.inkLight, 0.003);
    k.box(w - 0.22, 0.01, d - 0.22, 0, 0.002, 0, alt ? TONE.rugFieldWarm : TONE.rugField, 0.003);
  },

  plant(k, it) {
    const reach = m(Math.max(it.w ?? 420, it.d ?? 420), 420) / 2;
    if (opt(it, 'tall')) fig(k, reach);
    else bush(k, reach);
  },

  floorLamp(k) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      k.rod([Math.sin(a) * 0.15, 0, Math.cos(a) * 0.15], [Math.sin(a) * 0.014, 0.62, Math.cos(a) * 0.014], 0.008, 0.012, PAL.walnut, 6);
    }
    k.rod([0, 0.6, 0], [0, 1.46, 0], 0.011, 0.009, PAL.walnut, 8);
    k.lathe(DRUM, 0, 1.38, 0, PAL.cream, 24, 'lamp');
  },

  aircon(k) {
    k.box(0.88, 0.29, 0.19, 0, 2.2, 0.095, PAL.white, 0.035);
    k.box(0.78, 0.016, 0.01, 0, 2.228, 0.19, PAL.steelDark, 0);
    k.box(0.8, 0.012, 0.045, 0, 2.205, 0.168, PAL.white, 0.004, [0.45, 0, 0]);
    k.box(0.02, 0.008, 0.006, 0.34, 2.3, 0.193, PAL.sageDark, 0);
  },

  shoeCabinet(k, it) {
    const w = m(it.w, 1000);
    const d = m(it.d, 350);
    // It floats on a dark plinth set well back, with floor clear under it for the slippers worn indoors.
    const lift = 0.16;
    k.box(w - 0.08, lift, 0.09, 0, 0, -d / 2 + 0.055, PAL.dark, 0.004);
    k.box(w, 0.84, d - 0.03, 0, lift, -0.015, PAL.white, 0.01);
    for (let i = 0; i < 2; i++) {
      const x = -w / 4 + (w / 2) * i;
      k.box(w / 2 - 0.006, 0.8, 0.014, x, lift + 0.02, d / 2 - 0.023, PAL.oakLight, 0.005);
      k.box(0.012, 0.16, 0.008, x + (i ? -1 : 1) * (w / 4 - 0.04), lift + 0.6, d / 2 - 0.012, PAL.walnut, 0.004);
    }
    k.box(w, 0.025, d, 0, 1.0, 0, PAL.oak, 0.008);
    // A dish for keys, and a pothos trailing over the front.
    k.lathe(PLATE, -w / 2 + 0.17, 1.025, 0, PAL.terracotta, 12);
    pothos(k, w / 2 - 0.16, 1.025, -0.04, d / 2 - 0.016, 0.16, 5);
    pair(k, w / 2 - 0.22, 0, d / 2 - 0.13, PAL.ink, 'slipper', 1, Math.PI);
  },

  shoeRack(k, it) {
    const w = m(it.w, 700);
    const d = m(it.d, 300);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.rod([sx * (w / 2 - 0.012), 0, sz * (d / 2 - 0.012)], [sx * (w / 2 - 0.012), 0.62, sz * (d / 2 - 0.012)], 0.009, 0.009, PAL.steelDark, 6);
    const tiers = [0.1, 0.34, 0.58];
    for (const y of tiers) k.box(w, 0.016, d, 0, y, 0, PAL.oakLight, 0.004);
    // What a family leaves at the door: flip-flops, white school shoes, everyday sneakers.
    const q = Math.min(0.175, w / 4);
    pair(k, -q, tiers[0] + 0.016, 0, PAL.dark, 'slipper');
    pair(k, q, tiers[0] + 0.016, 0.01, PAL.inkLight, 'slipper', 0.8);
    pair(k, -q, tiers[1] + 0.016, 0, PAL.white, 'school', 0.9);
    pair(k, q, tiers[1] + 0.016, -0.01, PAL.ink, 'sneaker');
    pair(k, -q, tiers[2] + 0.016, 0, PAL.walnut, 'sneaker', 1.04);
  },

  counter(k, it, set) {
    const w = m(it.w, 2400);
    const d = m(it.d, 600);
    const hob = num(it, 'hob');
    const sink = num(it, 'sink');
    const hx = hob === null ? null : -w / 2 + w * hob;
    const sx = sink === null ? null : w * sink;
    const top = 0.9;
    // The sink's opening, and the bay under it, which stops short so the bowl has room.
    const bw = 0.46;
    const bd = 0.36;
    const bz = 0.02;
    k.box(w - 0.01, 0.1, d - 0.08, 0, 0, -0.03, PAL.dark, 0.004);
    const carcass = (x0: number, x1: number, h: number) => {
      if (x1 - x0 > 0.01) k.box(x1 - x0, h, d - 0.04, (x0 + x1) / 2, 0.1, -0.02, PAL.white, 0.006);
    };
    if (sx === null) carcass(-w / 2, w / 2, 0.76);
    else {
      carcass(-w / 2, sx - bw / 2 - 0.03, 0.76);
      carcass(sx - bw / 2 - 0.03, sx + bw / 2 + 0.03, 0.6);
      carcass(sx + bw / 2 + 0.03, w / 2, 0.76);
    }
    // Fronts: a drawer over a door in each bay, with a slim pull.
    const n = Math.max(1, Math.round(w / 0.5));
    const dw = w / n;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + dw * (i + 0.5);
      k.box(dw - 0.004, 0.17, 0.018, x, 0.685, d / 2 - 0.031, PAL.oakLight, 0.004);
      k.box(dw - 0.004, 0.578, 0.018, x, 0.103, d / 2 - 0.031, PAL.oakLight, 0.004);
      k.box(Math.min(0.24, dw * 0.5), 0.012, 0.014, x, 0.8, d / 2 - 0.015, PAL.walnut, 0.004);
    }
    // The worktop, cut round the sink if there is one.
    const slab = (x0: number, x1: number, z0: number, z1: number, r: number) => {
      if (x1 - x0 > 0.005 && z1 - z0 > 0.005) k.box(x1 - x0, 0.04, z1 - z0, (x0 + x1) / 2, top - 0.04, (z0 + z1) / 2, PAL.quartz, r);
    };
    const busy: [number, number][] = [];
    if (sx === null) slab(-w / 2, w / 2, -d / 2, d / 2, 0.008);
    else {
      slab(-w / 2, sx - bw / 2, -d / 2, d / 2, 0);
      slab(sx + bw / 2, w / 2, -d / 2, d / 2, 0);
      slab(sx - bw / 2, sx + bw / 2, -d / 2, bz - bd / 2, 0);
      slab(sx - bw / 2, sx + bw / 2, bz + bd / 2, d / 2, 0);
      // A stainless bowl under the opening, a drain, and a gooseneck tap behind.
      const by = 0.72;
      k.box(bw, 0.006, bd, sx, by, bz, PAL.steelDark, 0);
      for (const s of [-1, 1]) {
        k.box(0.004, top - by, bd, sx + s * (bw / 2 - 0.002), by, bz, PAL.steel, 0);
        k.box(bw, top - by, 0.004, sx, by, bz + s * (bd / 2 - 0.002), PAL.steel, 0);
      }
      k.cyl(0.035, 0.035, 0.004, sx + 0.1, by + 0.006, bz, PAL.dark, 14);
      const tz = bz - bd / 2 - 0.045;
      k.cyl(0.022, 0.026, 0.05, sx, top, tz, PAL.steel, 14);
      k.tube([[sx, top + 0.04, tz], [sx, top + 0.24, tz], [sx, top + 0.3, tz + 0.06], [sx, top + 0.26, tz + 0.15], [sx, top + 0.2, tz + 0.16]], 0.011, 0.009, PAL.steel, 8, 12);
      k.box(0.016, 0.012, 0.07, sx + 0.035, top + 0.05, tz, PAL.steel, 0.005, [0, 0, 0.3]);
      busy.push([sx - bw / 2 - 0.03, sx + bw / 2 + 0.03]);
    }
    if (hx !== null) {
      // A gas hob, as most HDB kitchens have: black glass, two burners on their pan supports, knobs at the front.
      k.box(0.72, 0.008, 0.42, hx, top, 0, TONE.hob, 0.003);
      for (const s of [-1, 1]) {
        const cx = hx + s * 0.18;
        k.cyl(0.07, 0.075, 0.012, cx, top + 0.008, 0.01, PAL.steelDark, 20);
        k.cyl(0.042, 0.045, 0.014, cx, top + 0.02, 0.01, PAL.dark, 16);
        for (let j = 0; j < 4; j++) {
          const a = j * HALF + Math.PI / 4;
          k.box(0.075, 0.016, 0.012, cx + Math.cos(a) * 0.085, top + 0.008, 0.01 + Math.sin(a) * 0.085, PAL.dark, 0, [0, -a, 0]);
        }
        k.cyl(0.018, 0.02, 0.014, cx, top + 0.008, 0.17, PAL.dark, 12);
      }
      wok(k, hx - 0.18, top + 0.024, 0.01);
      busy.push([hx - 0.4, hx + 0.4]);
    }
    if (opt(it, 'upper')) {
      // Wall cabinets, with the cooker hood under them over the hob. Both go with their wall.
      const y0 = 1.6;
      const ud = 0.34;
      k.hang(0, y0 + 0.36, -d / 2 + ud / 2, () => {
        k.box(w, 0.72, ud - 0.02, 0, y0, -d / 2 + (ud - 0.02) / 2, PAL.white, 0.006);
        for (let i = 0; i < n; i++) k.box(dw - 0.006, 0.7, 0.018, -w / 2 + dw * (i + 0.5), y0 + 0.01, -d / 2 + ud - 0.011, PAL.white, 0.005);
        if (hx !== null) {
          k.box(0.72, 0.1, 0.44, hx, y0 - 0.1, -d / 2 + 0.22, PAL.steel, 0.01);
          k.box(0.66, 0.004, 0.36, hx, y0 - 0.104, -d / 2 + 0.22, PAL.steelDark, 0);
        }
      });
    }
    // What stands on the worktop, set out in the stretches the hob and sink leave free.
    const back = -d / 2 + 0.16;
    const things: Thing[] = [];
    if (set.appliances === it) {
      things.push({ w: 0.28, draw: (x) => riceCooker(k, x, top, back) });
      things.push({ w: 0.2, draw: (x) => kettle(k, x, top, back) });
    }
    if (sx !== null) {
      things.push({ w: 0.3, draw: (x) => dishRack(k, x, top, 0.0) });
      things.push({ w: 0.14, draw: (x) => soap(k, x, top, back) });
    } else if (hx !== null) {
      things.push({ w: 0.4, draw: (x) => board(k, x, top, 0.04) });
      things.push({ w: 0.22, draw: (x) => crock(k, x, top, back) });
    } else {
      things.push({ w: 0.2, draw: (x) => canisters(k, x, top, back) });
    }
    setOut(-w / 2 + 0.03, w / 2 - 0.03, busy, things);
  },

  fridge(k, it) {
    const w = m(it.w, 700);
    const d = m(it.d, 700);
    k.box(w, 1.78, d - 0.06, 0, 0.02, -0.03, TONE.appliance, 0.02);
    k.box(w - 0.008, 0.6, 0.04, 0, 1.19, d / 2 - 0.04, TONE.applianceDoor, 0.014);
    k.box(w - 0.008, 1.15, 0.04, 0, 0.03, d / 2 - 0.04, TONE.applianceDoor, 0.014);
    k.box(0.022, 0.3, 0.018, w / 2 - 0.06, 1.3, d / 2 - 0.011, PAL.steelDark, 0.006);
    k.box(0.022, 0.48, 0.018, w / 2 - 0.06, 0.62, d / 2 - 0.011, PAL.steelDark, 0.006);
    k.box(w - 0.08, 0.02, 0.01, 0, 0.0, d / 2 - 0.06, PAL.dark, 0);
  },

  washer(k, it) {
    const w = m(it.w, 600);
    const d = m(it.d, 600);
    k.box(w, 0.85, d - 0.02, 0, 0, -0.01, PAL.white, 0.02);
    k.cyl(0.19, 0.19, 0.02, 0, 0.42 - 0.01, d / 2 - 0.02, PAL.steel, 28, [HALF, 0, 0]);
    k.cyl(0.145, 0.145, 0.024, 0, 0.42 - 0.012, d / 2 - 0.02, TONE.porthole, 28, [HALF, 0, 0]);
    k.box(w - 0.06, 0.07, 0.01, 0, 0.73, d / 2 - 0.022, PAL.steelDark, 0);
    k.box(0.16, 0.05, 0.012, -w / 2 + 0.12, 0.74, d / 2 - 0.016, PAL.white, 0.004);
    k.cyl(0.03, 0.03, 0.014, w / 2 - 0.1, 0.765 - 0.007, d / 2 - 0.018, PAL.white, 16, [HALF, 0, 0]);
    // A woven laundry basket on top, and the chilli plant by the yard window behind it.
    k.lathe([[0, 0], [0.13, 0], [0.165, 0.2], [0.158, 0.205], [0.124, 0.012], [0, 0.012]], -0.06, 0.85, 0.04, PAL.linen, 18);
    k.box(0.22, 0.05, 0.16, -0.07, 1.0, 0.05, PAL.white, 0.02, [0.1, 0.4, 0]);
    chilli(k, w / 2 - 0.09, 0.85, -d / 2 + 0.08);
  },

  dryingRack(k) {
    // The bracket off the outside wall, its struts, and the poles across it.
    const y = 1.02;
    for (const sx of [-1, 1]) {
      k.rod([sx * 0.615, y, 0.01], [sx * 0.615, y, 1.0], 0.012, 0.012, PAL.steel, 6);
      k.rod([sx * 0.615, y - 0.32, 0.01], [sx * 0.615, y - 0.01, 0.45], 0.01, 0.01, PAL.steel, 6);
    }
    const poles = [0.18, 0.37, 0.56, 0.75, 0.94];
    for (const z of poles) k.rod([-0.618, y + 0.004, z], [0.618, y + 0.004, z], 0.011, 0.011, PAL.steel, 6);
    // The washing: a few things, each its own shape.
    shirt(k, -0.26, y, poles[0], PAL.white);
    towel(k, 0.26, y + 0.012, poles[1], 0.46, 0.5, PAL.sage);
    shirt(k, -0.16, y, poles[2], PAL.inkLight);
    shorts(k, 0.3, y, poles[3], PAL.ink);
    towel(k, -0.32, y + 0.012, poles[4], 0.34, 0.36, PAL.cream);
  },

  bookshelf(k, it) {
    const w = m(it.w, 1600);
    const d = m(it.d, 320);
    const h = 1.95;
    const t = 0.022;
    const bays = Math.max(1, Math.round(w / 0.8));
    const bw = (w - t * (bays + 1)) / bays;
    for (let i = 0; i <= bays; i++) k.box(t, h - 0.06, d, -w / 2 + t / 2 + i * (bw + t), 0.06, 0, PAL.oak, 0.004);
    const rows = 5;
    const pitch = (h - 0.06 - t) / rows;
    for (let r = 0; r <= rows; r++) k.box(w, t, d, 0, 0.06 + r * pitch, 0, PAL.oak, 0.004);
    k.box(w - 0.01, h - 0.06, 0.012, 0, 0.06, -d / 2 + 0.006, PAL.oakLight, 0.003);
    k.box(w, 0.06, d - 0.03, 0, 0, -0.015, PAL.dark, 0.003);
    // Every bay of every shelf gets its own mix, sized to the room in it.
    for (let r = 0; r < rows; r++) {
      for (let b = 0; b < bays; b++) {
        const x0 = -w / 2 + t + b * (bw + t) + 0.02;
        const room = bw - 0.04;
        const y = 0.06 + t + r * pitch;
        const z = 0.02;
        const seed = r * 3 + b * 5 + 1;
        const pick = (r * 2 + b) % 5;
        switch (pick === 3 && b > 0 ? 0 : pick) {
          case 0:
            books(k, x0, y, z, room, seed);
            break;
          case 1: {
            const used = books(k, x0, y, z, room - 0.16, seed);
            k.lathe([[0, 0], [0.04, 0], [0.06, 0.08], [0.04, 0.17], [0.046, 0.18], [0, 0.18]], x0 + used + 0.08, y, z, PAL.terracotta, 14);
            break;
          }
          case 2: {
            k.box(Math.min(0.3, room * 0.4), 0.2, 0.22, x0 + Math.min(0.15, room * 0.2), y, z - 0.01, PAL.linen, 0.012);
            books(k, x0 + Math.min(0.32, room * 0.42), y, z, room - Math.min(0.32, room * 0.42), seed);
            break;
          }
          case 3: {
            pothos(k, x0 + 0.1, y, 0.0, z + 0.075, 0.22);
            books(k, x0 + 0.22, y, z, room - 0.22, seed);
            break;
          }
          default: {
            const used = books(k, x0, y, z, room * 0.6, seed);
            stack(k, x0 + used + Math.min(0.14, (room - used) / 2), y, z, 3, seed);
          }
        }
      }
    }
  },

  wc(k) {
    // The pan, turned and stretched front to back, its lid down; the cistern against the wall.
    k.frame(0, 0, 0.09, [0, 0, 0], () => k.lathe(PAN, 0, 0, 0, PAL.white, 18), [1, 1, 1.32]);
    k.soft(0.36, 0.03, 0.46, 0, 0.392, 0.1, PAL.white, [0.35, 0.95], undefined, 14, 0.1);
    k.box(0.34, 0.4, 0.17, 0, 0.38, -0.25, PAL.white, 0.03);
    k.box(0.35, 0.03, 0.18, 0, 0.78, -0.25, PAL.white, 0.012);
    k.cyl(0.03, 0.03, 0.008, 0, 0.81, -0.24, PAL.steel, 16);
    // The hand spray every Singapore toilet has, in its holder on the wall by the cistern.
    k.box(0.026, 0.04, 0.02, 0.185, 0.6, -0.338, PAL.steel, 0.006);
    k.rod([0.185, 0.6, -0.326], [0.185, 0.7, -0.322], 0.011, 0.009, PAL.steel, 8);
    k.tube([[0.185, 0.6, -0.33], [0.19, 0.42, -0.31], [0.184, 0.3, -0.325], [0.185, 0.27, -0.34]], 0.004, 0.004, PAL.steel, 4, 10);
    k.cyl(0.013, 0.013, 0.02, 0.185, 0.27 - 0.01, -0.336, PAL.steel, 10, [HALF, 0, 0]);
  },

  vanity(k, it) {
    const w = m(it.w, 700);
    const d = m(it.d, 460);
    k.box(w, 0.44, d - 0.03, 0, 0.36, -0.015, PAL.oak, 0.008);
    k.box(w - 0.01, 0.4, 0.012, 0, 0.375, d / 2 - 0.024, PAL.oakLight, 0.004);
    k.box(w, 0.025, d, 0, 0.8, 0, PAL.quartz, 0.008);
    // A basin standing on the top, a little oval, with the tap behind it.
    k.frame(0, 0.825, 0.03, [0, 0, 0], () => k.lathe(BASIN, 0, 0, 0, PAL.white, 18), [1.2, 1, 1]);
    k.cyl(0.016, 0.019, 0.03, 0, 0.825, -d / 2 + 0.06, PAL.steel, 12);
    k.tube([[0, 0.85, -d / 2 + 0.06], [0, 0.96, -d / 2 + 0.06], [0, 0.98, -d / 2 + 0.1], [0, 0.955, -d / 2 + 0.15]], 0.008, 0.007, PAL.steel, 6, 8);
    // A cup of toothbrushes, the soap, and a hand towel over a rail at the front.
    k.cyl(0.03, 0.026, 0.09, w / 2 - 0.09, 0.825, -d / 2 + 0.08, PAL.sage, 12);
    for (const dx of [-0.01, 0.012]) k.rod([w / 2 - 0.09 + dx, 0.86, -d / 2 + 0.08], [w / 2 - 0.09 + dx * 2, 1.0, -d / 2 + 0.085], 0.004, 0.004, dx < 0 ? PAL.white : PAL.inkLight, 4);
    k.lathe([[0, 0], [0.028, 0], [0.028, 0.1], [0.01, 0.12], [0.008, 0.15], [0, 0.15]], -w / 2 + 0.08, 0.825, -d / 2 + 0.08, PAL.cream, 10);
    k.rod([-0.17, 0.74, d / 2 - 0.012], [0.17, 0.74, d / 2 - 0.012], 0.006, 0.006, PAL.steel, 6);
    for (const s of [-1, 1]) k.box(0.012, 0.012, 0.014, s * 0.17, 0.734, d / 2 - 0.019, PAL.steel, 0);
    k.cyl(0.011, 0.011, 0.28, 0, 0.74 - 0.14, d / 2 - 0.013, PAL.linen, 10, [0, 0, HALF]);
    k.box(0.28, 0.3, 0.006, 0, 0.44, d / 2 - 0.004, PAL.linen, 0.002);
    // The mirror, a rounded oblong in a pale timber frame, goes with its wall.
    k.hang(0, 1.35, -d / 2, () => {
      k.soft(w - 0.08, 0.016, 0.74, 0, 1.35 - 0.008, -d / 2 + 0.008, PAL.oakLight, [0.2, 0.3], [HALF, 0, 0], 12, 0);
      k.soft(w - 0.11, 0.012, 0.71, 0, 1.35 - 0.006, -d / 2 + 0.018, PAL.mirror, [0.2, 0.3], [HALF, 0, 0], 12, 0);
    });
  },

  showerScreen(k, it) {
    const w = m(it.w, 1000);
    k.box(w - 0.04, 1.92, 0.008, 0, 0.03, 0, PAL.glass, 0, undefined, 'glass');
    k.box(w, 0.025, 0.02, 0, 0, 0, PAL.steel, 0.004);
    k.box(w - 0.02, 0.016, 0.016, 0, 1.95, 0, PAL.steel, 0.004);
    // A channel at either end: one meets the wall, the other finishes the free edge, whichever way round the room is.
    for (const s of [-1, 1]) k.box(0.02, 1.97, 0.022, s * (w / 2 - 0.01), 0, 0, PAL.steel, 0.004);
    // A towel over the top rail, hanging both sides of the glass.
    const tx = w / 2 - 0.3;
    k.cyl(0.009, 0.009, 0.34, tx, 1.966 - 0.17, 0, PAL.sage, 8, [0, 0, HALF]);
    for (const s of [-1, 1]) k.box(0.34, 0.46, 0.003, tx, 1.5, s * 0.0095, PAL.sage, 0);
  },

  rack(k, it) {
    const w = m(it.w, 1500);
    const d = m(it.d, 450);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.03, 1.8, 0.03, sx * (w / 2 - 0.015), 0, sz * (d / 2 - 0.015), PAL.steelDark, 0.004);
    const ys = [0.12, 0.66, 1.2, 1.74];
    for (const y of ys) k.box(w, 0.02, d, 0, y, 0, PAL.steel, 0.004);
    // What a household shelter ends up holding: cartons, storage boxes with lids, a rolled mat.
    const rows: [number, number, number, boolean][][] = [
      [[0.5, 0.36, PAL.card, false], [0.42, 0.3, PAL.white, true], [0.36, 0.4, PAL.card, false]],
      [[0.44, 0.34, PAL.card, false], [0.5, 0.26, PAL.white, true], [0.3, 0.3, PAL.card, false]],
      [[0.4, 0.3, PAL.white, true], [0.56, 0.36, PAL.card, false]]
    ];
    rows.forEach((row, r) => {
      let x = -w / 2 + 0.05;
      for (const [bw, bh, hex, lid] of row) {
        if (x + bw > w / 2 - 0.05) break;
        k.box(bw, bh, d - 0.1, x + bw / 2, ys[r] + 0.02, 0, hex, lid ? 0.008 : 0);
        if (lid) k.box(bw + 0.01, 0.025, d - 0.09, x + bw / 2, ys[r] + 0.02 + bh, 0, PAL.inkLight, 0);
        else k.box(0.05, 0.003, d - 0.1, x + bw / 2, ys[r] + 0.02 + bh, 0, PAL.cream, 0);
        x += bw + 0.04;
      }
    });
    const mat = Math.min(0.9, w - 0.12);
    k.cyl(0.07, 0.07, mat, 0, ys[3] + 0.02 + 0.07 - mat / 2, 0, PAL.sage, 14, [0, 0, HALF]);
  },

  compressor(k) {
    k.box(0.82, 0.58, 0.3, 0, 0.08, -0.01, PAL.cream, 0.02);
    for (const sx of [-1, 1]) k.box(0.06, 0.08, 0.28, sx * 0.3, 0, -0.01, PAL.steelDark, 0.006);
    k.cyl(0.21, 0.21, 0.01, -0.12, 0.37 - 0.005, 0.145, PAL.steelDark, 28, [HALF, 0, 0]);
    k.cyl(0.07, 0.07, 0.014, -0.12, 0.37 - 0.007, 0.15, PAL.steel, 18, [HALF, 0, 0]);
    for (let i = 0; i < 4; i++) k.box(0.2, 0.012, 0.004, 0.24, 0.24 + i * 0.07, 0.142, PAL.steelDark, 0);
  },

  hsVent(k) {
    for (const x of [-0.22, 0.22]) {
      k.cyl(0.095, 0.095, 0.022, x, 2.2 - 0.011, 0.011, PAL.steel, 24, [HALF, 0, 0]);
      k.cyl(0.06, 0.06, 0.028, x, 2.2 - 0.014, 0.014, PAL.steelDark, 20, [HALF, 0, 0]);
    }
  }
};

/** Height at which pieces hung on a wall sit, metres. They appear there, and leave with their wall. */
export const MOUNTED: Record<string, number> = { aircon: 2.34, hsVent: 2.2 };

/** The middle of a piece's back edge, where it meets the wall it stands against. */
function behind(it: Item): Item {
  const [fx, fy] = FRONT[it.face ?? 'S'];
  const half = (it.d ?? 0) / 2;
  return { ...it, x: it.x - fx * half, y: it.y - fy * half };
}

/**
 * Builds every furnishing of a plan into the kit. Delay staggers the pop-in
 * by distance from a point; `wallOf` finds the wall a mounted piece hangs on,
 * and the wall a floor piece stands against, for what it hangs there.
 */
export function furnish(
  k: Kit,
  items: Item[],
  toWorld: (x: number, y: number) => [number, number],
  delayOf: (x: number, y: number) => number,
  wallOf: (it: Item) => number
): void {
  const counters = items.filter((it) => it.kind === 'counter');
  const set: Setting = {
    appliances: counters.find((it) => num(it, 'hob') === null && num(it, 'sink') === null) ?? counters.find((it) => num(it, 'hob') !== null) ?? null
  };
  for (const it of items) {
    const make = makers[it.kind];
    if (!make) continue;
    const [x, z] = toWorld(it.x, it.y);
    const mount = MOUNTED[it.kind];
    const opts: PlaceOptions = mount === undefined ? { back: wallOf(behind(it)) } : { wall: wallOf(it), pivotY: mount };
    k.place(x, z, turn[it.face ?? 'S'], delayOf(it.x, it.y), () => make(k, it, set), opts);
  }
}
