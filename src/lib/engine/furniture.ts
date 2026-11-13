import type { Item } from '../plan/types';
import { PAL } from './materials';
import type { Kit, PlaceOptions } from './mesh';

const HALF = Math.PI / 2;
const turn = { S: 0, E: HALF, N: Math.PI, W: -HALF } as const;

type Maker = (k: Kit, it: Item) => void;

const m = (mm: number | undefined, fallback: number) => (mm ?? fallback) / 1000;
const opt = (it: Item, key: string) => it.opts?.[key];

function chair(k: Kit, x: number, z: number, rot: number, seat: number = PAL.fabricLight): void {
  k.sub(x, 0, z, rot, () => {
    k.box(0.44, 0.045, 0.44, 0, 0.43, 0, seat, 0.02);
    k.box(0.44, 0.36, 0.035, 0, 0.5, -0.2, seat, 0.016, [-0.1, 0, 0]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.03, 0.43, 0.03, sx * 0.19, 0, sz * 0.19, PAL.walnut, 0.006);
  });
}

function books(k: Kit, x: number, y0: number, z: number, n: number, seed: number): void {
  const tones = [PAL.ink, PAL.orange, PAL.sageDark, PAL.cream, PAL.walnut, PAL.inkLight];
  let cx = x;
  for (let i = 0; i < n; i++) {
    const w = 0.025 + ((seed * (i + 3) * 7) % 5) * 0.006;
    const h = 0.2 + ((seed * (i + 1) * 13) % 5) * 0.018;
    k.box(w, h, 0.15, cx + w / 2, y0, z, tones[(seed + i) % tones.length], 0.003);
    cx += w + 0.003;
  }
}

function plantBody(k: Kit, tall: boolean): void {
  const h = tall ? 0.42 : 0.3;
  k.cyl(0.19, 0.14, h, 0, 0, 0, PAL.cream, 24);
  k.cyl(0.165, 0.165, 0.02, 0, h - 0.03, 0, PAL.walnut, 24);
  if (tall) {
    k.cyl(0.018, 0.024, 0.75, 0, h, 0, PAL.walnut, 8);
    const leaves: [number, number, number, number][] = [
      [0, 1.42, 0, 0.3],
      [0.2, 1.22, 0.08, 0.24],
      [-0.18, 1.26, -0.1, 0.25],
      [0.05, 1.12, -0.2, 0.22],
      [-0.08, 1.08, 0.2, 0.22],
      [0.16, 1.56, -0.08, 0.2],
      [-0.12, 1.6, 0.06, 0.19]
    ];
    leaves.forEach(([x, y, z, r], i) => k.ball(r, x, y, z, i % 2 ? PAL.leafLight : PAL.leaf, 1, 0.82, 1));
  } else {
    const leaves: [number, number, number, number][] = [
      [0, 0.52, 0, 0.2],
      [0.13, 0.44, 0.06, 0.15],
      [-0.12, 0.46, -0.07, 0.16],
      [0.02, 0.62, -0.05, 0.13]
    ];
    leaves.forEach(([x, y, z, r], i) => k.ball(r, x, y, z, i % 2 ? PAL.leafLight : PAL.leaf, 1, 0.85, 1));
  }
}

const makers: Record<string, Maker> = {
  sofa(k, it) {
    const w = m(it.w, 2200);
    const d = m(it.d, 920);
    const daybed = !!opt(it, 'daybed');
    const body = daybed ? PAL.sage : PAL.fabric;
    const cushion = daybed ? 0xa7b5a2 : PAL.fabricLight;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(0.022, 0.016, 0.1, sx * (w / 2 - 0.1), 0, sz * (d / 2 - 0.1), PAL.walnut, 10);
    k.box(w, 0.2, d, 0, 0.1, 0, body, 0.045);
    k.box(w, 0.44, 0.2, 0, 0.3, -d / 2 + 0.1, body, 0.07);
    for (const sx of [-1, 1]) k.box(0.17, 0.3, d - 0.02, sx * (w / 2 - 0.085), 0.3, 0.01, body, 0.07);
    const n = w > 2 ? 3 : 2;
    const inner = w - 0.34 - 0.02;
    const cw = inner / n;
    for (let i = 0; i < n; i++) {
      const cx = -inner / 2 + cw * (i + 0.5);
      k.box(cw - 0.015, 0.15, d - 0.24, cx, 0.3, 0.09, cushion, 0.055);
      k.box(cw - 0.03, 0.34, 0.15, cx, 0.42, -d / 2 + 0.27, cushion, 0.065, [-0.14, 0, 0]);
    }
    k.box(0.42, 0.4, 0.13, -inner / 2 + 0.24, 0.44, -d / 2 + 0.42, PAL.orange, 0.06, [-0.3, 0.25, 0]);
    k.box(0.38, 0.36, 0.12, inner / 2 - 0.22, 0.44, -d / 2 + 0.42, daybed ? PAL.cream : PAL.ink, 0.055, [-0.3, -0.2, 0]);
  },

  bed(k, it) {
    const w = m(it.w, 1520);
    const l = m(it.d, 2000);
    const alt = !!opt(it, 'tone');
    k.box(w + 0.07, 0.24, l + 0.05, 0, 0.05, 0, PAL.oak, 0.02);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.05, 0.05, 0.05, sx * (w / 2 - 0.05), 0, sz * (l / 2 - 0.05), PAL.walnut, 0.008);
    k.box(w, 0.2, l, 0, 0.29, 0, PAL.white, 0.06);
    k.box(w + 0.05, 0.11, l * 0.66, 0, 0.44, l * 0.17, alt ? PAL.inkLight : PAL.linen, 0.05);
    k.box(w + 0.05, 0.05, 0.24, 0, 0.52, -l * 0.16 + 0.1, PAL.white, 0.024);
    const pw = w > 1.3 ? w / 2 - 0.1 : w - 0.22;
    const xs = w > 1.3 ? [-w / 4, w / 4] : [0];
    for (const px of xs) k.box(pw, 0.13, 0.4, px, 0.47, -l / 2 + 0.29, PAL.white, 0.06, [0.08, 0, 0]);
    k.box(w + 0.11, 0.98, 0.09, 0, 0.05, -l / 2 - 0.045, alt ? PAL.oakLight : PAL.fabricLight, 0.035);
    k.box(w * 0.72, 0.02, 0.62, 0, 0.55, l * 0.33, alt ? PAL.cream : PAL.sage, 0.01);
  },

  sideTable(k, it) {
    const w = m(it.w, 450);
    const d = m(it.d, 420);
    k.box(w, 0.36, d, 0, 0.12, 0, PAL.oak, 0.014);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.03, 0.12, 0.03, sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.04), PAL.walnut, 0.006);
    k.box(w - 0.03, 0.006, 0.01, 0, 0.29, d / 2 + 0.002, PAL.walnut, 0.002);
    k.cyl(0.05, 0.065, 0.02, 0, 0.48, 0, PAL.dark, 16);
    k.cyl(0.008, 0.008, 0.22, 0, 0.5, 0, PAL.dark, 8);
    k.cyl(0.07, 0.11, 0.16, 0, 0.7, 0, PAL.cream, 20, undefined, 'lamp');
  },

  wardrobe(k, it) {
    const w = m(it.w, 1500);
    const d = m(it.d, 600);
    const h = 2.32;
    k.box(w, h, d - 0.02, 0, 0, -0.01, PAL.white, 0.006);
    const n = Math.max(2, Math.round(w / 0.5));
    const dw = w / n;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + dw * (i + 0.5);
      k.box(dw - 0.008, h - 0.09, 0.02, x, 0.07, d / 2 - 0.004, i % 2 ? PAL.oakLight : PAL.white, 0.005);
      k.box(0.012, 0.28, 0.018, x + (i % 2 ? -1 : 1) * (dw / 2 - 0.04), 1.02, d / 2 + 0.014, PAL.walnut, 0.004);
    }
    k.box(w, 0.07, d - 0.06, 0, 0, -0.02, PAL.dark, 0.004);
  },

  desk(k, it) {
    const w = m(it.w, 1200);
    const d = m(it.d, 600);
    const vanity = !!opt(it, 'vanity');
    k.box(w, 0.035, d, 0, 0.715, 0, PAL.oak, 0.012);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.035, 0.715, 0.035, sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05), vanity ? PAL.oak : PAL.dark, 0.006);
    if (vanity) {
      k.cyl(0.2, 0.2, 0.012, 0, 0.92, -d / 2 + 0.03, PAL.mirror, 28, [HALF, 0, 0]);
      k.cyl(0.215, 0.215, 0.01, 0, 0.92, -d / 2 + 0.02, PAL.oak, 28, [HALF, 0, 0]);
      k.cyl(0.035, 0.03, 0.09, w / 2 - 0.16, 0.75, -0.04, PAL.terracotta, 14);
      k.cyl(0.028, 0.028, 0.06, w / 2 - 0.26, 0.75, 0.04, PAL.cream, 14);
      k.sub(0, 0, d / 2 + 0.16, Math.PI, () => {
        k.cyl(0.19, 0.19, 0.07, 0, 0.4, 0, PAL.fabricLight, 22);
        k.cyl(0.02, 0.16, 0.4, 0, 0, 0, PAL.oak, 14);
      });
      return;
    }
    k.box(0.34, 0.014, 0.23, -0.08, 0.75, 0.02, PAL.steel, 0.004);
    k.box(0.34, 0.22, 0.01, -0.08, 0.76, -0.1, PAL.dark, 0.004, [-0.24, 0, 0]);
    k.cyl(0.04, 0.045, 0.1, w / 2 - 0.17, 0.75, -0.06, PAL.white, 14);
    books(k, -w / 2 + 0.1, 0.75, -d / 2 + 0.11, 4, 3);
    k.cyl(0.06, 0.08, 0.015, w / 2 - 0.14, 0.75, -d / 2 + 0.13, PAL.dark, 16);
    k.cyl(0.007, 0.007, 0.32, w / 2 - 0.14, 0.76, -d / 2 + 0.13, PAL.dark, 8);
    k.cyl(0.05, 0.09, 0.1, w / 2 - 0.14, 1.06, -d / 2 + 0.16, PAL.orange, 16, [0.5, 0, 0], 'lamp');
    chair(k, 0.02, d / 2 + 0.14, Math.PI, PAL.fabric);
  },

  diningSet(k, it) {
    const w = m(it.w, 1600);
    const d = m(it.d, 850);
    k.box(w, 0.04, d, 0, 0.71, 0, PAL.oak, 0.018);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.06, 0.71, 0.06, sx * (w / 2 - 0.12), 0, sz * (d / 2 - 0.1), PAL.oak, 0.012);
    for (const cx of [-w / 3 + 0.03, 0, w / 3 - 0.03]) {
      chair(k, cx, d / 2 + 0.1, Math.PI);
      chair(k, cx, -d / 2 - 0.1, 0);
      for (const sz of [-1, 1]) k.cyl(0.115, 0.09, 0.014, cx, 0.75, sz * (d / 2 - 0.2), PAL.white, 22);
    }
    k.cyl(0.15, 0.09, 0.07, 0, 0.75, 0, PAL.cream, 22);
    const fruit: [number, number][] = [[0.04, 0.03], [-0.05, 0.02], [0, -0.05]];
    fruit.forEach(([x, z]) => k.ball(0.042, x, 0.83, z, PAL.orange));
    k.ball(0.042, 0.005, 0.89, 0, PAL.orange);
  },

  pendant(k) {
    k.cyl(0.004, 0.004, 0.72, 0, 1.86, 0, PAL.dark, 6);
    k.cyl(0.05, 0.05, 0.02, 0, 2.57, 0, PAL.dark, 14);
    k.cyl(0.07, 0.24, 0.2, 0, 1.66, 0, PAL.cream, 28, undefined, 'lamp');
  },

  tvConsole(k, it) {
    const w = m(it.w, 1800);
    const d = m(it.d, 450);
    k.box(w, 0.36, d, 0, 0.14, 0, PAL.oak, 0.014);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.035, 0.14, 0.035, sx * (w / 2 - 0.1), 0, sz * (d / 2 - 0.07), PAL.walnut, 0.006);
    for (let i = 0; i < 3; i++) k.box(w / 3 - 0.012, 0.3, 0.014, -w / 3 + (w / 3) * i, 0.17, d / 2 + 0.004, PAL.oakLight, 0.004);
    k.box(1.32, 0.76, 0.035, 0, 0.92, -d / 2 + 0.03, PAL.dark, 0.012);
    k.box(1.27, 0.71, 0.004, 0, 0.945, -d / 2 + 0.05, 0x17181b, 0.002);
    books(k, -w / 2 + 0.12, 0.5, 0.02, 5, 2);
    k.cyl(0.05, 0.07, 0.17, w / 2 - 0.2, 0.5, 0.03, PAL.terracotta, 16);
    k.ball(0.09, w / 2 - 0.2, 0.74, 0.03, PAL.leaf, 1, 0.9, 1);
  },

  coffeeTable(k) {
    k.cyl(0.4, 0.4, 0.035, 0, 0.35, 0, PAL.oak, 40);
    k.cyl(0.05, 0.05, 0.33, 0, 0.02, 0, PAL.dark, 14);
    k.cyl(0.22, 0.24, 0.02, 0, 0, 0, PAL.dark, 28);
    k.box(0.24, 0.022, 0.17, -0.1, 0.385, 0.06, PAL.ink, 0.004, [0, 0.3, 0]);
    k.box(0.22, 0.018, 0.16, -0.1, 0.407, 0.06, PAL.cream, 0.004, [0, 0.12, 0]);
    k.cyl(0.04, 0.032, 0.07, 0.15, 0.385, -0.08, PAL.white, 14);
  },

  rug(k, it) {
    const w = m(it.w, 1700);
    const d = m(it.d, 2300);
    const alt = !!opt(it, 'tone');
    k.box(w, 0.008, d, 0, 0.002, 0, alt ? PAL.terracotta : PAL.inkLight, 0.003);
    k.box(w - 0.22, 0.01, d - 0.22, 0, 0.002, 0, alt ? 0xe3d3c0 : 0xdfe2e4, 0.003);
  },

  plant(k, it) {
    plantBody(k, !!opt(it, 'tall'));
  },

  floorLamp(k) {
    k.cyl(0.15, 0.16, 0.02, 0, 0, 0, PAL.dark, 24);
    k.cyl(0.011, 0.011, 1.46, 0, 0.02, 0, PAL.dark, 8);
    k.cyl(0.13, 0.19, 0.27, 0, 1.44, 0, PAL.cream, 28, undefined, 'lamp');
  },

  aircon(k) {
    k.box(0.88, 0.29, 0.2, 0, 2.2, 0.1, PAL.white, 0.05);
    k.box(0.8, 0.012, 0.03, 0, 2.215, 0.19, PAL.steel, 0.004);
  },

  shoeCabinet(k, it) {
    const w = m(it.w, 1000);
    const d = m(it.d, 350);
    k.box(w, 0.92, d, 0, 0.08, 0, PAL.white, 0.01);
    k.box(w - 0.04, 0.08, d - 0.06, 0, 0, 0, PAL.dark, 0.004);
    for (let i = 0; i < 2; i++) k.box(w / 2 - 0.01, 0.86, 0.016, -w / 4 + (w / 2) * i, 0.11, d / 2 + 0.004, PAL.oakLight, 0.005);
    k.box(w + 0.02, 0.025, d + 0.02, 0, 1.0, 0, PAL.oak, 0.008);
    k.cyl(0.09, 0.06, 0.04, -w / 2 + 0.18, 1.025, 0, PAL.terracotta, 18);
    k.sub(w / 2 - 0.2, 1.025, 0, 0, () => {
      k.cyl(0.07, 0.055, 0.13, 0, 0, 0, PAL.cream, 16);
      k.ball(0.11, 0, 0.22, 0, PAL.leaf, 1, 0.9, 1);
      k.ball(0.08, 0.06, 0.3, 0.02, PAL.leafLight);
    });
  },

  shoeRack(k, it) {
    const w = m(it.w, 700);
    const d = m(it.d, 300);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.02, 0.6, 0.02, sx * (w / 2 - 0.01), 0, sz * (d / 2 - 0.01), PAL.steelDark, 0.004);
    for (const y of [0.08, 0.32, 0.56]) k.box(w, 0.015, d, 0, y, 0, PAL.oakLight, 0.004);
    const shoes: [number, number, number][] = [[-0.2, 0.095, PAL.dark], [0.02, 0.095, PAL.white], [0.2, 0.095, PAL.orange], [-0.12, 0.335, PAL.ink], [0.14, 0.335, PAL.cream]];
    shoes.forEach(([x, y, c]) => {
      k.box(0.09, 0.07, 0.24, x, y, 0, c, 0.03);
      k.box(0.09, 0.07, 0.24, x + 0.1, y, 0, c, 0.03);
    });
  },

  counter(k, it) {
    const w = m(it.w, 2400);
    const d = m(it.d, 600);
    const hob = opt(it, 'hob');
    const sink = opt(it, 'sink');
    k.box(w - 0.01, 0.1, d - 0.08, 0, 0, -0.03, PAL.dark, 0.004);
    k.box(w, 0.76, d - 0.03, 0, 0.1, -0.015, PAL.white, 0.006);
    const n = Math.max(1, Math.round(w / 0.48));
    const dw = w / n;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + dw * (i + 0.5);
      k.box(dw - 0.008, 0.73, 0.018, x, 0.115, d / 2 - 0.02, PAL.oakLight, 0.005);
      k.box(dw * 0.45, 0.012, 0.016, x, 0.79, d / 2 - 0.005, PAL.walnut, 0.004);
    }
    k.box(w + 0.004, 0.04, d + 0.02, 0, 0.86, 0, PAL.quartz, 0.008);
    if (typeof hob === 'number') {
      const hx = -w / 2 + w * hob;
      k.box(0.6, 0.008, 0.48, hx, 0.9, 0, 0x1c1d20, 0.003);
      for (const sx of [-1, 1]) {
        k.cyl(0.085, 0.085, 0.012, hx + sx * 0.15, 0.908, 0.02, PAL.steelDark, 22);
        k.cyl(0.05, 0.05, 0.016, hx + sx * 0.15, 0.908, 0.02, PAL.dark, 18);
      }
      if (opt(it, 'upper')) k.box(0.6, 0.1, 0.44, hx, 1.5, -d / 2 + 0.24, PAL.steel, 0.01);
    }
    if (opt(it, 'upper')) {
      const y0 = 1.6;
      k.box(w, 0.72, 0.34, 0, y0, -d / 2 + 0.17, PAL.white, 0.006);
      for (let i = 0; i < n; i++) k.box(dw - 0.008, 0.7, 0.016, -w / 2 + dw * (i + 0.5), y0 + 0.01, -d / 2 + 0.345, PAL.white, 0.005);
      k.box(w, 0.012, 0.3, 0, y0 - 0.012, -d / 2 + 0.17, PAL.cream, 0.003, undefined, 'lamp');
      // A few things on the worktop.
      k.cyl(0.06, 0.07, 0.2, w / 2 - 0.3, 0.9, -d / 2 + 0.16, PAL.steel, 16);
      k.box(0.3, 0.02, 0.2, w / 2 - 0.75, 0.9, -0.02, PAL.oak, 0.006);
      k.cyl(0.045, 0.045, 0.16, -w / 2 + 0.22, 0.9, -d / 2 + 0.14, PAL.cream, 14);
      k.cyl(0.04, 0.04, 0.13, -w / 2 + 0.34, 0.9, -d / 2 + 0.14, PAL.terracotta, 14);
    }
    if (typeof sink === 'number') {
      const sx = w * sink;
      k.box(0.54, 0.006, 0.42, sx, 0.9, 0, PAL.steel, 0.003);
      k.box(0.48, 0.008, 0.36, sx, 0.902, 0, PAL.steelDark, 0.003);
      k.cyl(0.014, 0.018, 0.24, sx, 0.9, -d / 2 + 0.07, PAL.steel, 10);
      k.box(0.024, 0.02, 0.16, sx, 1.12, -d / 2 + 0.14, PAL.steel, 0.008);
      k.cyl(0.035, 0.035, 0.12, sx - 0.42, 0.9, -d / 2 + 0.1, PAL.sageDark, 14);
    }
  },

  fridge(k, it) {
    const w = m(it.w, 700);
    const d = m(it.d, 700);
    k.box(w, 1.78, d - 0.05, 0, 0.02, -0.025, 0xdfe1e2, 0.02);
    k.box(w - 0.006, 1.08, 0.04, 0, 0.7, d / 2 - 0.03, 0xe9ebec, 0.014);
    k.box(w - 0.006, 0.66, 0.04, 0, 0.03, d / 2 - 0.03, 0xe9ebec, 0.014);
    k.box(0.02, 0.5, 0.03, -w / 2 + 0.06, 0.95, d / 2 + 0.005, PAL.steelDark, 0.006);
    k.box(0.02, 0.3, 0.03, -w / 2 + 0.06, 0.33, d / 2 + 0.005, PAL.steelDark, 0.006);
  },

  washer(k, it) {
    const w = m(it.w, 600);
    const d = m(it.d, 600);
    k.box(w, 0.85, d, 0, 0, 0, PAL.white, 0.02);
    k.cyl(0.2, 0.2, 0.03, 0, 0.42, d / 2 + 0.005, PAL.steel, 28, [HALF, 0, 0]);
    k.cyl(0.15, 0.15, 0.036, 0, 0.42, d / 2 + 0.006, 0x35404a, 28, [HALF, 0, 0]);
    k.box(w - 0.06, 0.07, 0.012, 0, 0.75, d / 2 + 0.002, PAL.steelDark, 0.004);
    k.box(0.4, 0.2, 0.3, 0, 0.87, 0, PAL.cream, 0.05);
  },

  dryingRack(k) {
    const y = 1.02;
    for (const sx of [-1, 1]) k.box(0.025, 0.025, 1.0, sx * 0.62, y, 0.5, PAL.steel, 0.005);
    for (let i = 0; i < 5; i++) k.box(1.26, 0.016, 0.016, 0, y + 0.004, 0.18 + i * 0.19, PAL.steel, 0.005);
    const cloths: [number, number, number, number, number][] = [
      [-0.3, 0.37, 0.5, 0.55, PAL.white],
      [0.28, 0.56, 0.42, 0.7, PAL.inkLight],
      [-0.05, 0.75, 0.6, 0.48, PAL.orange],
      [0.34, 0.94, 0.4, 0.4, PAL.cream]
    ];
    cloths.forEach(([x, z, w, h, c]) => k.box(w, h, 0.012, x, y - h, z, c, 0.004));
  },

  bookshelf(k, it) {
    const w = m(it.w, 1600);
    const d = m(it.d, 320);
    const h = 1.95;
    for (const sx of [-1, 0, 1]) k.box(0.025, h, d, sx * (w / 2 - 0.0125), 0, 0, PAL.oak, 0.004);
    for (let i = 0; i <= 5; i++) k.box(w, 0.025, d, 0, 0.06 + i * ((h - 0.085) / 5), 0, PAL.oak, 0.004);
    k.box(w - 0.02, h - 0.06, 0.012, 0, 0.06, -d / 2 + 0.006, PAL.oakLight, 0.003);
    for (let row = 0; row < 5; row++) {
      const y = 0.085 + row * ((h - 0.085) / 5);
      for (const side of [-1, 1]) {
        const x0 = side < 0 ? -w / 2 + 0.05 : 0.05;
        const pick = (row * 2 + (side < 0 ? 0 : 1)) % 5;
        if (pick === 0) books(k, x0, y, 0.02, 9, row + 2);
        else if (pick === 1) {
          books(k, x0, y, 0.02, 5, row + 5);
          k.cyl(0.05, 0.065, 0.16, x0 + 0.5, y, 0.02, PAL.terracotta, 14);
        } else if (pick === 2) {
          k.box(0.32, 0.2, 0.22, x0 + 0.2, y, 0.01, PAL.linen, 0.012);
          books(k, x0 + 0.42, y, 0.02, 4, row + 1);
        } else if (pick === 3) {
          k.cyl(0.07, 0.055, 0.12, x0 + 0.16, y, 0.02, PAL.cream, 14);
          k.ball(0.1, x0 + 0.16, y + 0.2, 0.02, PAL.leaf, 1, 0.9, 1);
          books(k, x0 + 0.34, y, 0.02, 6, row + 7);
        } else books(k, x0 + 0.1, y, 0.02, 7, row + 4);
      }
    }
  },

  wc(k) {
    k.box(0.38, 0.38, 0.17, 0, 0.4, -0.26, PAL.white, 0.03);
    k.box(0.36, 0.4, 0.5, 0, 0, 0.06, PAL.white, 0.11);
    k.box(0.37, 0.03, 0.46, 0, 0.4, 0.08, 0xfefefe, 0.012);
    k.box(0.1, 0.012, 0.03, 0, 0.785, -0.26, PAL.steel, 0.005);
  },

  vanity(k, it) {
    const w = m(it.w, 700);
    const d = m(it.d, 460);
    k.box(w, 0.44, d - 0.02, 0, 0.36, -0.01, PAL.oak, 0.008);
    k.box(w + 0.01, 0.03, d + 0.01, 0, 0.8, 0, PAL.quartz, 0.008);
    k.box(0.44, 0.11, 0.32, 0, 0.83, 0.02, PAL.white, 0.05);
    k.cyl(0.011, 0.014, 0.15, 0, 0.83, -d / 2 + 0.05, PAL.steel, 10);
    k.box(0.02, 0.016, 0.11, 0, 0.97, -d / 2 + 0.1, PAL.steel, 0.006);
    k.box(w - 0.08, 0.72, 0.016, 0, 1.18, -d / 2 + 0.01, PAL.mirror, 0.006);
    k.box(w - 0.06, 0.74, 0.01, 0, 1.17, -d / 2 + 0.004, PAL.oakLight, 0.004);
  },

  showerScreen(k, it) {
    const w = m(it.w, 1000);
    k.box(w, 1.95, 0.01, 0, 0.02, 0, PAL.glass, 0.002, undefined, 'glass');
    k.box(w, 0.02, 0.024, 0, 1.97, 0, PAL.steel, 0.004);
    k.box(w, 0.02, 0.024, 0, 0, 0, PAL.steel, 0.004);
  },

  rack(k, it) {
    const w = m(it.w, 1500);
    const d = m(it.d, 450);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.03, 1.8, 0.03, sx * (w / 2 - 0.015), 0, sz * (d / 2 - 0.015), PAL.steelDark, 0.004);
    const ys = [0.12, 0.66, 1.2, 1.74];
    for (const y of ys) k.box(w, 0.02, d, 0, y, 0, PAL.steel, 0.004);
    const loads: [number, number, number, number, number][] = [
      [-0.45, 0, 0.5, 0.36, PAL.card],
      [0.25, 0, 0.42, 0.3, PAL.cream],
      [-0.3, 1, 0.44, 0.34, PAL.card],
      [0.3, 1, 0.5, 0.26, PAL.inkLight],
      [-0.4, 2, 0.4, 0.3, PAL.cream],
      [0.2, 2, 0.56, 0.36, PAL.card]
    ];
    loads.forEach(([x, row, bw, bh, c]) => k.box(bw, bh, d - 0.1, x, ys[row] + 0.02, 0, c, 0.012));
  },

  compressor(k) {
    k.box(0.82, 0.58, 0.32, 0, 0.08, 0, PAL.cream, 0.02);
    for (const sx of [-1, 1]) k.box(0.06, 0.08, 0.3, sx * 0.3, 0, 0, PAL.steelDark, 0.006);
    k.cyl(0.21, 0.21, 0.012, -0.12, 0.37, 0.162, PAL.steelDark, 28, [HALF, 0, 0]);
    k.cyl(0.07, 0.07, 0.02, -0.12, 0.37, 0.165, PAL.steel, 18, [HALF, 0, 0]);
  },

  hsVent(k) {
    for (const x of [-0.22, 0.22]) {
      k.cyl(0.095, 0.095, 0.03, x, 2.2, 0.015, PAL.steel, 24, [HALF, 0, 0]);
      k.cyl(0.06, 0.06, 0.036, x, 2.2, 0.016, PAL.steelDark, 20, [HALF, 0, 0]);
    }
  }
};

/** Height at which pieces hung on a wall sit, metres. They appear there, and leave with their wall. */
export const MOUNTED: Record<string, number> = { aircon: 2.34, hsVent: 2.2 };

/**
 * Builds every furnishing of a plan into the kit. Delay staggers the pop-in
 * by distance from a point; `wallOf` finds the wall a mounted piece hangs on.
 */
export function furnish(
  k: Kit,
  items: Item[],
  toWorld: (x: number, y: number) => [number, number],
  delayOf: (x: number, y: number) => number,
  wallOf: (it: Item) => number
): void {
  for (const it of items) {
    const make = makers[it.kind];
    if (!make) continue;
    const [x, z] = toWorld(it.x, it.y);
    const mount = MOUNTED[it.kind];
    const opts: PlaceOptions = mount === undefined ? {} : { wall: wallOf(it), pivotY: mount };
    k.place(x, z, turn[it.face ?? 'S'], delayOf(it.x, it.y), () => make(k, it), opts);
  }
}
