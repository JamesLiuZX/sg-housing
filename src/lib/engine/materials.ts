import * as THREE from 'three';

/** The maquette palette. Colours are sRGB hex; three converts to linear on use. */
export const PAL = {
  wall: 0xfbf8f2,
  wallBase: 0xdcd6ca,
  capSolid: 0x25272b,
  capPartition: 0x8f8b84,
  capWindow: 0x9fc0cc,
  capParapet: 0xb9b4ab,
  slabEdge: 0xe9e4da,
  paper: 0xf7f3ea,
  frame: 0x3b3e43,
  glass: 0xbcd7e0,

  oak: 0xcfad80,
  oakLight: 0xdcc19b,
  walnut: 0x7d5c40,
  white: 0xf5f3ee,
  cream: 0xece6da,
  linen: 0xd9d1c2,
  fabric: 0xb7afa2,
  fabricLight: 0xc9c2b6,
  sage: 0x97a892,
  sageDark: 0x6f8a6b,
  leaf: 0x5f8a62,
  leafLight: 0x86a877,
  ink: 0x3c4a60,
  inkLight: 0x8493a8,
  orange: 0xe07b39,
  terracotta: 0xc98a66,
  quartz: 0xeeebe4,
  steel: 0x8a9096,
  steelDark: 0x5c6268,
  dark: 0x2a2c30,
  mirror: 0xc7d6dc,
  card: 0xc9aa7f,

  ruleNo: 0xd3463c,
  ruleShelter: 0x9c2a2a,
  ruleYes: 0x2f9e6c,
  ruleWet: 0xd99a1e,

  sun: 0xff9a3d
} as const;

const cache = new Map<number, THREE.Color>();
export function col(hex: number): THREE.Color {
  let c = cache.get(hex);
  if (!c) {
    c = new THREE.Color(hex);
    cache.set(hex, c);
  }
  return c;
}

export interface Uniforms {
  uRise: THREE.IUniform<number>;
  uDraw: THREE.IUniform<number>;
  uRule: THREE.IUniform<number>;
  uPop: THREE.IUniform<number>;
  uReveal: THREE.IUniform<number>;
}

export function makeUniforms(): Uniforms {
  return {
    uRise: { value: 0 },
    uDraw: { value: 0 },
    uRule: { value: 0 },
    uPop: { value: 0 },
    uReveal: { value: 0 }
  };
}

const BACK_OUT = /* glsl */ `
float blkBack(float t) {
  float u = t - 1.0;
  return 1.0 + 2.2 * u * u * u + 1.2 * u * u;
}`;

type Patch = {
  key: string;
  uniforms: Record<string, THREE.IUniform>;
  vertexHead?: string;
  vertexBody?: string;
  fragmentHead?: string;
  fragmentColor?: string;
};

function patch<T extends THREE.Material>(mat: T, p: Patch): T {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, p.uniforms);
    if (p.vertexHead) shader.vertexShader = p.vertexHead + '\n' + shader.vertexShader;
    if (p.vertexBody) {
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + p.vertexBody);
    }
    if (p.fragmentHead) shader.fragmentShader = p.fragmentHead + '\n' + shader.fragmentShader;
    if (p.fragmentColor) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + p.fragmentColor);
    }
  };
  mat.customProgramCacheKey = () => p.key;
  return mat;
}

const RISE_HEAD = /* glsl */ `
attribute float aDelay;
uniform float uRise;
${BACK_OUT}`;
const RISE_BODY = /* glsl */ `
transformed.y *= blkBack(clamp((uRise - aDelay * 0.62) / 0.38, 0.0, 1.0));`;

/** Geometry that grows out of the floor: walls, frames, doors. */
export function riseMaterial<T extends THREE.Material>(mat: T, u: Uniforms, opts: { rule?: number; draw?: boolean } = {}): T {
  const rule = opts.rule ?? 0;
  return patch(mat, {
    key: `blk-rise-${rule}-${opts.draw ? 1 : 0}`,
    uniforms: { uRise: u.uRise, uRule: u.uRule, uDraw: u.uDraw },
    vertexHead:
      RISE_HEAD +
      (rule ? '\nattribute vec3 aRule;\nvarying vec3 vRule;' : '') +
      (opts.draw ? '\nvarying float vDelay;' : ''),
    vertexBody: RISE_BODY + (rule ? '\nvRule = aRule;' : '') + (opts.draw ? '\nvDelay = aDelay;' : ''),
    fragmentHead:
      (rule ? 'uniform float uRule;\nvarying vec3 vRule;\n' : '') + (opts.draw ? 'uniform float uDraw;\nvarying float vDelay;\n' : ''),
    fragmentColor:
      (rule ? `diffuseColor.rgb = mix(diffuseColor.rgb, vRule, uRule * ${rule.toFixed(2)});\n` : '') +
      (opts.draw ? 'diffuseColor.a *= smoothstep(vDelay * 0.7, vDelay * 0.7 + 0.3, uDraw);\n' : '')
  });
}

const POP_HEAD = /* glsl */ `
attribute float aDelay;
attribute vec3 aPivot;
uniform float uPop;
${BACK_OUT}`;
const POP_BODY = /* glsl */ `
transformed = aPivot + (transformed - aPivot) * blkBack(clamp((uPop - aDelay * 0.7) / 0.3, 0.0, 1.0));`;

/** Geometry that scales up from a point on the floor: furniture. */
export function popMaterial<T extends THREE.Material>(mat: T, u: Uniforms): T {
  return patch(mat, { key: 'blk-pop', uniforms: { uPop: u.uPop }, vertexHead: POP_HEAD, vertexBody: POP_BODY });
}

/** Depth material so shadows follow the same vertex animation as the visible mesh. */
export function depthFor(kind: 'rise' | 'pop', u: Uniforms): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  return kind === 'rise'
    ? patch(mat, { key: 'blk-depth-rise', uniforms: { uRise: u.uRise }, vertexHead: RISE_HEAD, vertexBody: RISE_BODY })
    : patch(mat, { key: 'blk-depth-pop', uniforms: { uPop: u.uPop }, vertexHead: POP_HEAD, vertexBody: POP_BODY });
}

/** The floor starts as blank paper and takes on its finishes in a wave from the front door. */
export function floorMaterial(map: THREE.Texture, u: Uniforms, rect: THREE.Vector4, origin: THREE.Vector2, reach: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = u.uReveal;
    shader.uniforms.uRect = { value: rect };
    shader.uniforms.uOrigin = { value: origin };
    shader.uniforms.uReach = { value: reach };
    shader.uniforms.uPaper = { value: new THREE.Color(PAL.paper) };
    shader.fragmentShader =
      'uniform float uReveal;\nuniform vec4 uRect;\nuniform vec2 uOrigin;\nuniform float uReach;\nuniform vec3 uPaper;\n' +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        vec2 blkW = uRect.xy + vec2(vMapUv.x, 1.0 - vMapUv.y) * uRect.zw;
        float blkD = distance(blkW, uOrigin);
        float blkEdge = uReveal * (uReach + 1.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, uPaper, smoothstep(blkEdge - 1.6, blkEdge, blkD));`
      );
  };
  mat.customProgramCacheKey = () => 'blk-floor';
  return mat;
}
