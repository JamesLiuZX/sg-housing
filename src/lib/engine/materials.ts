import * as THREE from 'three';

/** The maquette palette. Colours are sRGB hex; three converts to linear on use. */
export const PAL = {
  wall: 0xfbf9f4,
  // Section cuts are pencil graphite rather than black, so they belong to the paper they are drawn on.
  capSolid: 0x3d3f44,
  capPartition: 0x9d9990,
  capWindow: 0x9fc3d2,
  capParapet: 0xbfbab0,
  /** Lines that exist only in the plan drawing: door swings and glazing. */
  planLine: 0x77736b,
  slabEdge: 0xe4ded2,
  paper: 0xf7f3ea,
  frame: 0x3b3e43,
  glass: 0xd3e6ee,

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
  /** One entry per wall: 0 standing, 1 cut down to a stub so the camera can see past it. */
  uCut: THREE.IUniform<Float32Array>;
  /** x: height of a cut wall. y: height a standing wall is clipped at, clear of the overshoot as walls spring up. */
  uCutSpan: THREE.IUniform<THREE.Vector2>;
  /** Plan-space light: lamps (r), bounced sun (g), daylight from windows (b), indoors (a). */
  uField: THREE.IUniform<THREE.Texture | null>;
  /** World rectangle the field covers: x, z, width, depth. */
  uFieldRect: THREE.IUniform<THREE.Vector4>;
  /** Lamplight colour times strength. Zero by day. */
  uLamp: THREE.IUniform<THREE.Color>;
  /** Sunlight bounced around a room once it comes through the windows. */
  uBounce: THREE.IUniform<THREE.Color>;
  /** 0 in the dollhouse, where the open top lets the sky into every room; 1 inside, where only windows do. */
  uInside: THREE.IUniform<number>;
  /** 0 night to 1 day, for the unlit section caps. */
  uDay: THREE.IUniform<number>;
  /** The wall chosen in the rules lens, or -1. The others step back so it stands out. */
  uSel: THREE.IUniform<number>;
}

/** Height in metres of a wall cut down so the camera can see past it. */
export const STUB = 0.36;

/** How tall a wall is drawn for a cut value, matching the shader: eased, so it settles rather than stops. */
export function cutTop(cut: number, span: THREE.Vector2): number {
  const k = cut * cut * (3 - 2 * cut);
  return span.y + (span.x - span.y) * k;
}

export function makeUniforms(walls: number, height: number): Uniforms {
  return {
    uRise: { value: 0 },
    uDraw: { value: 0 },
    uRule: { value: 0 },
    uPop: { value: 0 },
    uReveal: { value: 0 },
    uCut: { value: new Float32Array(Math.max(1, walls)) },
    uCutSpan: { value: new THREE.Vector2(STUB, height * 1.15) },
    uField: { value: null },
    uFieldRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uLamp: { value: new THREE.Color(0, 0, 0) },
    uBounce: { value: new THREE.Color(0, 0, 0) },
    uInside: { value: 0 },
    uDay: { value: 1 },
    uSel: { value: -1 }
  };
}

/** What a material does beyond plain lighting. Each flag adds a small piece of shader. */
export interface Features {
  /** Grows out of the floor with uRise, staggered by aDelay. */
  rise?: boolean;
  /** Belongs to a wall (aWall) and is cut down with it. */
  fold?: boolean;
  /** Scales up from aPivot with uPop. With fold, pieces hung on a wall (aWall ≥ 0) also leave with it. */
  pop?: boolean;
  /** How strongly the rules lens recolours this material, 0 to 1. Needs aRule. */
  rule?: number;
  /** Section caps: drawn in by uDraw, kept clear of what they cover (aLift), plan-only lines sink (aPlan). */
  cap?: boolean;
  /** Lit by the plan-space field: lamps, bounce and window daylight. */
  field?: boolean;
  /** Darken light from the sky and the room near the floor, over this many metres. */
  foot?: number;
  /** Ceiling height, metres: indoors, light falls off a little where walls meet the ceiling. Needs field. */
  head?: number;
  /** Soft-edged sun shadows. */
  soft?: boolean;
  /** Clear when seen straight through, milky along the pane. */
  glass?: boolean;
  /** The floor: blank paper until uReveal sweeps out from the door. */
  reveal?: { rect: THREE.Vector4; origin: THREE.Vector2; reach: number };
  /** Baked contact shading on the map's UVs: red from walls, green from furniture, which fades with uPop. */
  contact?: THREE.Texture;
}

const BACK_OUT = /* glsl */ `
float blkBack(float t) {
  float u = t - 1.0;
  return 1.0 + 2.2 * u * u * u + 1.2 * u * u;
}`;

/**
 * three's percentage-closer filter, widened. The 4×4 taps of the soft filter
 * are spread `shadowRadius` texels apart and blended bilinearly, so the edge
 * of a sun patch is a smooth ramp a few centimetres wide, with no banding and
 * no noise, for the same 16 reads.
 */
const SOFT_PCF = /* glsl */ `
			vec2 blkStep = max( shadowRadius, 1.0 ) / shadowMapSize;
			vec2 blkF = fract( shadowCoord.xy / blkStep + 0.5 );
			vec2 blkUv = shadowCoord.xy - blkF * blkStep;
			float blkZ = shadowCoord.z;
			#define BLK_TAP( x, y ) texture2DCompare( shadowMap, blkUv + vec2( x, y ) * blkStep, blkZ )
			#define BLK_ROW( y ) ( mix( BLK_TAP( -1.0, y ), BLK_TAP( 2.0, y ), blkF.x ) + BLK_TAP( 0.0, y ) + BLK_TAP( 1.0, y ) )
			shadow = ( mix( BLK_ROW( -1.0 ), BLK_ROW( 2.0 ), blkF.y ) + BLK_ROW( 0.0 ) + BLK_ROW( 1.0 ) ) * ( 1.0 / 9.0 );
			#undef BLK_ROW
			#undef BLK_TAP
`;

let softChunk: string | null = null;
/** The shadow chunk with the PCF branch of the directional filter swapped for SOFT_PCF. */
function softShadowChunk(): string {
  if (softChunk !== null) return softChunk;
  const src = THREE.ShaderChunk.shadowmap_pars_fragment;
  const open = '#if defined( SHADOWMAP_TYPE_PCF )';
  const close = '#elif defined( SHADOWMAP_TYPE_PCF_SOFT )';
  const a = src.indexOf(open);
  const b = a < 0 ? -1 : src.indexOf(close, a);
  // If three changes the chunk, keep its own filter rather than break the shader.
  softChunk = a < 0 || b < 0 ? src : src.slice(0, a + open.length) + '\n' + SOFT_PCF + '\n' + src.slice(b);
  return softChunk;
}

/**
 * Khronos PBR Neutral, with a stronger pull toward white in the highlights.
 * Everything below the knee keeps its exact colour, so paper stays paper in
 * the shade; direct sun bleaches a floor toward cream the way it does in a
 * real room, which is what makes a patch read as sunlight and not as a
 * yellow rug. Installed through three's documented custom tone mapping hook.
 */
const TONE = /* glsl */ `
vec3 CustomToneMapping( vec3 color ) {
	const float start = 0.76;
	const float desaturation = 0.55;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < start ) return color;
	float d = 1.0 - start;
	float newPeak = 1.0 - d * d / ( peak + d - start );
	color *= newPeak / peak;
	float g = 1.0 - 1.0 / ( desaturation * ( peak - newPeak ) + 1.0 );
	return mix( color, vec3( newPeak ), g );
}`;

export function installToneMapping(): void {
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  const stub = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  if (chunk.includes(stub)) THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(stub, TONE);
}

/** Adds the features to a three material through its shader hooks. */
export function shade<T extends THREE.Material>(mat: T, u: Uniforms, f: Features): T {
  const walls = u.uCut.value.length;
  const rule = f.rule ?? 0;
  const lit = !!(f.field || f.foot || f.contact);
  const key = [
    'blk',
    f.rise ? 'r' : '',
    f.fold ? `f${walls}` : '',
    f.pop ? 'p' : '',
    rule ? `u${rule}` : '',
    f.cap ? 'c' : '',
    f.field ? 'l' : '',
    f.foot ? `t${f.foot}` : '',
    f.head ? `h${f.head}` : '',
    f.soft ? 's' : '',
    f.glass ? 'g' : '',
    f.reveal ? 'v' : '',
    f.contact ? 'k' : ''
  ].join('');

  const uniforms: Record<string, THREE.IUniform> = {};
  let vHead = '';
  let vBody = '';
  let fHead = '';
  let fColor = '';
  let fLight = '';

  if (f.rise || f.pop) vHead += `attribute float aDelay;\n${BACK_OUT}\n`;
  if (f.fold) {
    Object.assign(uniforms, { uCut: u.uCut, uCutSpan: u.uCutSpan });
    vHead += `attribute float aWall;\nuniform float uCut[${walls}];\nuniform vec2 uCutSpan;\n`;
  }
  if (f.rise) {
    uniforms.uRise = u.uRise;
    vHead += 'uniform float uRise;\n';
    vBody += 'float blkK = blkBack(clamp((uRise - aDelay * 0.62) / 0.38, 0.0, 1.0));\n';
    // Caps keep their lift whatever the scale; anything else waits a centimetre under the
    // floor while flat, so the plan state shows the drawn lines and nothing fighting them.
    vBody += f.cap ? 'transformed.y *= blkK;\n' : 'transformed.y = transformed.y * blkK - 0.012 * (1.0 - min(blkK, 1.0));\n';
  }
  if (f.fold && !f.pop) {
    // A cut wall is clipped at stub height. What stood above the cut is pressed into a
    // sliver rather than removed, so faces keep their order and nothing flickers.
    vBody += 'float blkTop = mix(uCutSpan.y, uCutSpan.x, smoothstep(0.0, 1.0, uCut[int(aWall + 0.5)]));\n';
    vBody += f.cap
      ? 'transformed.y = min(transformed.y, blkTop);\n'
      : 'transformed.y = min(transformed.y, blkTop) + max(transformed.y - blkTop, 0.0) * 0.0002;\n';
  }
  if (f.cap) {
    Object.assign(uniforms, { uDraw: u.uDraw, uDay: u.uDay });
    if (!f.rise) Object.assign(uniforms, { uRise: u.uRise });
    vHead += 'attribute float aLift;\nattribute float aPlan;\nvarying float vBlkDelay;\n' + (f.rise ? '' : 'uniform float uRise;\n');
    // Lines that belong only to the drawing sink under the floor as the walls come up.
    vBody += 'transformed.y += aLift - aPlan * 0.05 * smoothstep(0.02, 0.3, uRise);\nvBlkDelay = aDelay;\n';
    fHead += 'uniform float uDraw;\nuniform float uDay;\nvarying float vBlkDelay;\n';
    fColor += 'diffuseColor.a *= smoothstep(vBlkDelay * 0.7, vBlkDelay * 0.7 + 0.3, uDraw);\n';
  }
  if (f.pop) {
    uniforms.uPop = u.uPop;
    vHead += 'attribute vec3 aPivot;\nuniform float uPop;\n';
    vBody += 'float blkS = blkBack(clamp((uPop - aDelay * 0.7) / 0.3, 0.0, 1.0));\n';
    if (f.fold) vBody += 'if (aWall > -0.5) blkS *= 1.0 - uCut[int(aWall + 0.5)];\n';
    vBody += 'transformed = aPivot + (transformed - aPivot) * blkS;\n';
  }
  if (rule) {
    Object.assign(uniforms, { uRule: u.uRule, uSel: u.uSel });
    vHead += 'attribute vec3 aRule;\nvarying vec3 vBlkRule;\nvarying float vBlkSel;\nuniform float uSel;\n';
    // With a wall chosen, every other wall keeps only a hint of its verdict.
    vBody += 'vBlkRule = aRule;\n';
    vBody += f.fold ? 'vBlkSel = uSel < -0.5 ? 1.0 : 1.0 - step(0.5, abs(aWall - uSel));\n' : 'vBlkSel = 1.0;\n';
    fHead += 'uniform float uRule;\nvarying vec3 vBlkRule;\nvarying float vBlkSel;\n';
    fColor += `diffuseColor.rgb = mix(diffuseColor.rgb, vBlkRule, uRule * ${rule.toFixed(2)} * mix(0.38, 1.0, vBlkSel));\n`;
  }
  if (f.cap) fColor += 'diffuseColor.rgb *= mix(0.34, 1.0, uDay);\n';
  if (lit) {
    vHead += 'varying float vBlkY;\n';
    vBody += 'vBlkY = (modelMatrix * vec4(transformed, 1.0)).y;\n';
    fHead += 'varying float vBlkY;\n';
    fLight += 'float blkAo = 1.0;\n';
  }
  if (f.foot) fLight += `blkAo *= mix(0.62, 1.0, smoothstep(-0.02, ${f.foot.toFixed(3)}, vBlkY));\n`;
  if (f.contact) {
    Object.assign(uniforms, { uContactMap: { value: f.contact }, uPop: u.uPop });
    fHead += 'uniform sampler2D uContactMap;\nuniform float uPop;\n';
    // Furniture's shading arrives with the furniture and leaves with it.
    fLight += 'vec2 blkC = texture2D(uContactMap, vMapUv).rg;\nblkAo *= blkC.r * mix(1.0, blkC.g, clamp(uPop, 0.0, 1.0));\n';
  }
  if (f.field) {
    Object.assign(uniforms, { uField: u.uField, uFieldRect: u.uFieldRect, uLamp: u.uLamp, uBounce: u.uBounce, uInside: u.uInside });
    vHead += 'uniform vec4 uFieldRect;\nvarying vec2 vBlkFieldUv;\nvarying float vBlkUp;\n';
    // Sample a hand's width in front of the surface, so each face of a wall takes the light of its own room.
    vBody += /* glsl */ `
vec3 blkW = (modelMatrix * vec4(transformed, 1.0)).xyz;
vec3 blkN = normalize(mat3(modelMatrix) * objectNormal);
vBlkFieldUv = (blkW.xz + blkN.xz * 0.14 - uFieldRect.xy) / uFieldRect.zw;
vBlkUp = blkN.y;
`;
    fHead += 'uniform sampler2D uField;\nuniform vec3 uLamp;\nuniform vec3 uBounce;\nuniform float uInside;\nvarying vec2 vBlkFieldUv;\nvarying float vBlkUp;\n';
    fLight += /* glsl */ `
vec4 blkF = texture2D(uField, vBlkFieldUv);
// The field is stored as square roots so its dim tails keep their precision in eight bits.
blkF.rgb *= blkF.rgb;
// Indoors, the sky reaches a spot only through the windows that can see it.
irradiance *= mix(1.0, 0.42 + 0.78 * blkF.b, uInside * blkF.a);
// Lamps light what faces up a little more than what faces sideways.
// Bounce mostly escapes through the open top of the dollhouse; under the ceiling it stays.
irradiance += uLamp * blkF.r * (0.72 + 0.28 * max(vBlkUp, 0.0)) + uBounce * blkF.g * mix(0.35, 1.0, uInside);
`;
    // Only indoors: from the dollhouse, the top of a wall is a section cut, not a corner.
    if (f.head) fLight += `blkAo *= 1.0 - 0.16 * uInside * blkF.a * smoothstep(${(f.head - 0.4).toFixed(3)}, ${f.head.toFixed(3)}, vBlkY);\n`;
  }
  if (lit) fLight += 'irradiance *= blkAo;\n';
  if (f.glass) {
    fColor += /* glsl */ `
float blkGlance = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
diffuseColor.a = mix(0.1, 0.58, blkGlance * blkGlance);
`;
  }
  let fMap = '';
  let fFinal = '';
  if (f.reveal) {
    Object.assign(uniforms, {
      uReveal: u.uReveal,
      uRect: { value: f.reveal.rect },
      uOrigin: { value: f.reveal.origin },
      uReach: { value: f.reveal.reach },
      uPaper: { value: col(PAL.paper).clone() }
    });
    fHead += 'uniform float uReveal;\nuniform vec4 uRect;\nuniform vec2 uOrigin;\nuniform float uReach;\nuniform vec3 uPaper;\nfloat blkBlank;\n';
    fMap = /* glsl */ `
vec2 blkPos = uRect.xy + vec2(vMapUv.x, 1.0 - vMapUv.y) * uRect.zw;
float blkEdge = uReveal * (uReach + 1.6);
blkBlank = smoothstep(blkEdge - 1.6, blkEdge, distance(blkPos, uOrigin));
`;
    // The blank sheet is drawn unlit, so the plan state is the colour of paper whatever the hour.
    fFinal = 'gl_FragColor.rgb = mix(gl_FragColor.rgb, uPaper, blkBlank);\n';
  }

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let vs = shader.vertexShader;
    let fs = shader.fragmentShader;
    if (vHead) vs = vHead + vs;
    if (vBody) vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + vBody);
    if (fHead) fs = fHead + fs;
    if (fMap) fs = fs.replace('#include <map_fragment>', '#include <map_fragment>\n' + fMap);
    if (fColor) fs = fs.replace('#include <color_fragment>', '#include <color_fragment>\n' + fColor);
    if (fLight) fs = fs.replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + fLight);
    if (f.soft) fs = fs.replace('#include <shadowmap_pars_fragment>', softShadowChunk());
    if (fFinal) fs = fs.replace('#include <tonemapping_fragment>', '#include <tonemapping_fragment>\n' + fFinal);
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

/**
 * Depth material so shadows follow the same rise and pop as the visible mesh.
 * The cut is left out on purpose: shadows come from the flat as built, so the
 * sun on the floor stays true whichever walls are down.
 */
export function depthFor(kind: 'rise' | 'pop', u: Uniforms): THREE.MeshDepthMaterial {
  return shade(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), u, kind === 'rise' ? { rise: true } : { pop: true });
}

/**
 * The shade the model throws on the table, from one baked image of its
 * footprint: a tight contact shadow that is always there, and a soft cast
 * shadow swept away from the sun. Both are quiet, so the model sits on the
 * paper instead of on a grey sheet.
 */
export function tableMaterial(map: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      map: { value: map },
      /** How far the cast shadow reaches, as a fraction of the image. */
      uShift: { value: new THREE.Vector2() },
      uContact: { value: 0.22 },
      uCast: { value: 0 },
      uTint: { value: new THREE.Color(0x2a2218) }
    },
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform sampler2D map;
uniform vec2 uShift;
uniform float uContact;
uniform float uCast;
uniform vec3 uTint;
varying vec2 vUv;
void main() {
  float tight = texture2D(map, vUv).r;
  // A box on a table throws its outline swept along the light, so sample along the sweep.
  float wide = 0.0;
  for (int i = 1; i <= 5; i++) wide = max(wide, texture2D(map, vUv - uShift * (float(i) / 5.0)).g * (1.0 - 0.1 * float(i)));
  float a = 1.0 - (1.0 - uContact * tight) * (1.0 - uCast * wide);
  gl_FragColor = vec4(uTint, a);
  #include <colorspace_fragment>
}`
  });
}
