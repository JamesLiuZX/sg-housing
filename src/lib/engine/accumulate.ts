import * as THREE from 'three';

/**
 * The settled picture.
 *
 * While anything moves, the viewer draws its one fast pass straight to the
 * canvas, as it always has. Once the picture is still, it is refined here,
 * one sample per animation frame, into the average of many samples, the way
 * a design tool's viewport settles. Each sample is the scene drawn exactly as
 * the fast pass draws it (same programs, same tone mapping, same multisampled
 * canvas), with three things moved a little:
 *
 * - the camera, by a fraction of a pixel, so edges and thin parts come out
 *   supersampled;
 * - the sun, within a small disc round its true direction, so its shadows are
 *   crisp where they touch and soften as they travel;
 * - a "studio dome": a light from somewhere in a cone round the zenith whose
 *   shadow map is drawn from the model's real geometry, the flat's invisible
 *   ceiling left out. It does not add light. It says, for this sample, which
 *   surfaces the softbox over a roofless model can see, and the sky, bounce
 *   and lamp light every surface already receives is kept off the ones it
 *   cannot. Averaged, that is the soft ambient shadow of a model photographed
 *   under a softbox: darker corners, floors dimming toward walls, furniture
 *   standing on the floor.
 *
 * Energy is kept by construction: a surface the dome sees in every sample
 * receives exactly the fast pass's light in every sample, so open floor and
 * open wall do not change at all, and only what is occluded darkens. The
 * running average is shown blended from the fast frame, its share growing to
 * all of it at the last sample, so no frame is ever worse than the one before
 * and the change reads as the image quietly settling.
 *
 * The samples are kept as they are displayed (tone mapped, sRGB, premultiplied
 * against the transparent canvas), so the average is of what is on screen,
 * line weights stay as the fast pass draws them, and the edges against the
 * page come out right. The running mean is held in half float where the
 * device can render to it; elsewhere in two eight-bit buffers that dither
 * each step, so the mean stays unbiased.
 */

export type Quality = 'fast' | 'full';

/** Half-angle of the studio dome's cone round the zenith, degrees. */
export const DOME_CONE = 38;
/**
 * Radius of the sun's disc in the settled picture, degrees. The real sun's is
 * 0.27°; at the scale the model is seen at, a shadow that soft would read as
 * hard-edged, so the disc is drawn larger, and a patch's edge softens a few
 * centimetres for every metre its light travels past the window head.
 */
export const SUN_DISC = 1.1;

/** Samples for a fine pointer (a desktop) and a coarse one (a phone). */
const SAMPLES_FINE = 48;
const SAMPLES_COARSE = 32;
/** The fewest samples automatic timing cuts to on a slow device. */
const SAMPLES_MIN = 10;
/** Settling should not run longer than this, milliseconds. */
const BUDGET_MS = 2400;
/** Side of the dome's shadow map, texels. Its shadow is soft, so this is plenty. */
const DOME_SIZE = 768;
/**
 * How far one dome sample's shadow is blurred, as a share of the angle
 * between neighbouring samples: enough that the copies of a shadow from
 * neighbouring directions merge into one gradient, at any distance.
 */
const DOME_BLUR = 0.75;
/** Camera jitter, pixels: the spread of a Gaussian, cut off at 2.5 of them. The canvas is multisampled already. */
const JITTER = 0.3;

const R2A = 0.7548776662466927;
const R2B = 0.5698402909980532;
const frac = (x: number) => x - Math.floor(x);

/** The radical inverse of i in a base: the Halton sequence. */
function halton(i: number, base: number): number {
  let f = 1;
  let r = 0;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/** The uniforms every lit material reads for the dome, shared by all of them. */
export interface DomeUniforms {
  /** 1 while a settled sample is drawn, 0 for the fast pass. */
  uBlkDomeOn: THREE.IUniform<number>;
  /** The dome's depth, packed, for finding what shades a point and how far off it is. */
  uBlkDomeMap: THREE.IUniform<THREE.Texture | null>;
  /** The same depth as a depth texture compared in hardware, for the blur. */
  uBlkDomeShadow: THREE.IUniform<THREE.Texture | null>;
  /** World to the map: x, y in 0..1 across it, z the depth it stores. */
  uBlkDomeMatrix: THREE.IUniform<THREE.Matrix4>;
  /** Toward the dome light, world. */
  uBlkDomeDir: THREE.IUniform<THREE.Vector3>;
  /**
   * x: metres per unit of stored depth. y: how far a surface is lifted off
   * itself along its normal before it is looked up, metres. z: blur radius
   * per metre between a surface and what shades it. w: the reach of the
   * search for what shades it, metres, and a little over the widest blur.
   */
  uBlkDomeSoft: THREE.IUniform<THREE.Vector4>;
  /** Map units per metre, across and up the map; and a depth bias in stored units. */
  uBlkDomeScale: THREE.IUniform<THREE.Vector3>;
  /** The blur's taps turned for this sample: cosine and sine. */
  uBlkDomeSpin: THREE.IUniform<THREE.Vector2>;
}

/**
 * The dome's occlusion, looked up once per sample per pixel. Back faces of
 * the dome are not occluded by definition: a face turned from the softbox
 * gets the same light it would in the fast pass, so only what a surface could
 * see of the softbox, and cannot, takes light away. The lookup searches a
 * little round the surface for what shades it, and blurs the shadow in
 * proportion to that distance, so neighbouring samples' shadows join up.
 */
const DOME_PARS = /* glsl */ `
uniform float uBlkDomeOn;
uniform sampler2D uBlkDomeMap;
uniform sampler2DShadow uBlkDomeShadow;
uniform mat4 uBlkDomeMatrix;
uniform vec3 uBlkDomeDir;
uniform vec4 uBlkDomeSoft;
uniform vec3 uBlkDomeScale;
uniform vec2 uBlkDomeSpin;
const vec2 BLK_DISK[ 12 ] = vec2[ 12 ](
	vec2( -0.326, -0.406 ), vec2( -0.840, -0.074 ), vec2( -0.696, 0.457 ), vec2( -0.203, 0.621 ),
	vec2( 0.962, -0.195 ), vec2( 0.473, -0.480 ), vec2( 0.519, 0.767 ), vec2( 0.185, -0.893 ),
	vec2( 0.507, 0.064 ), vec2( 0.896, 0.412 ), vec2( -0.322, -0.933 ), vec2( -0.792, -0.598 )
);
float blkDomeDepth( vec2 uv ) {
	return unpackRGBAToDepth( texture2D( uBlkDomeMap, uv ) );
}
float blkDome( vec3 viewPos, vec3 viewNormal ) {
	mat3 blkToWorld = transpose( mat3( viewMatrix ) );
	vec3 blkN = normalize( blkToWorld * viewNormal );
	float blkFacing = smoothstep( 0.0, 0.25, dot( blkN, uBlkDomeDir ) );
	if ( blkFacing <= 0.0 ) return 1.0;
	vec3 blkP = blkToWorld * ( viewPos - viewMatrix[ 3 ].xyz );
	vec4 blkC = uBlkDomeMatrix * vec4( blkP + blkN * uBlkDomeSoft.y, 1.0 );
	if ( any( lessThanEqual( blkC.xy, vec2( 0.0 ) ) ) || any( greaterThanEqual( blkC.xyz, vec3( 1.0 ) ) ) ) return 1.0;
	float blkZ = blkC.z - uBlkDomeScale.z;
	// The surface's own depth across the map, from its normal: every tap is compared against the
	// surface where that tap falls, so a wall seen at a slant never shades itself.
	mat3 blkT = transpose( mat3( uBlkDomeMatrix ) );
	mat3 blkB = inverse( transpose( mat3( blkT[ 0 ], blkT[ 1 ], blkN ) ) );
	vec2 blkGrad = clamp( vec2( dot( blkT[ 2 ], blkB[ 0 ] ), dot( blkT[ 2 ], blkB[ 1 ] ) ), -8.0, 8.0 );
	// What shades the point and how far off it is: four by four taps across the search, weighted
	// bilinearly to the map's grid, so the estimate, and the blur it sets, change smoothly.
	vec2 blkS = uBlkDomeSoft.w * uBlkDomeScale.xy / 1.5;
	vec2 blkF = fract( blkC.xy / blkS + 0.5 );
	vec2 blkO = blkC.xy - blkF * blkS;
	float blkFound = 0.0;
	float blkSum = 0.0;
	for ( int j = 0; j < 4; j ++ ) {
		for ( int i = 0; i < 4; i ++ ) {
			float w = ( i == 0 ? 1.0 - blkF.x : i == 3 ? blkF.x : 1.0 ) * ( j == 0 ? 1.0 - blkF.y : j == 3 ? blkF.y : 1.0 );
			vec2 uv = blkO + vec2( float( i ) - 1.0, float( j ) - 1.0 ) * blkS;
			float z = blkZ + dot( blkGrad, uv - blkC.xy );
			float d = blkDomeDepth( uv );
			float b = w * step( d, z );
			blkFound += b;
			blkSum += b * ( z - d );
		}
	}
	if ( blkFound < 1e-4 ) return 1.0;
	float blkGap = blkSum / blkFound * uBlkDomeSoft.x;
	vec2 blkR = clamp( blkGap * uBlkDomeSoft.z, 0.0, uBlkDomeSoft.w * 0.8 ) * uBlkDomeScale.xy;
	mat2 blkSpin = mat2( uBlkDomeSpin.x, uBlkDomeSpin.y, -uBlkDomeSpin.y, uBlkDomeSpin.x );
	float blkLit = 0.0;
	for ( int i = 0; i < 12; i ++ ) {
		vec2 o = ( blkSpin * BLK_DISK[ i ] ) * blkR;
		blkLit += texture( uBlkDomeShadow, vec3( blkC.xy + o, blkZ + dot( blkGrad, o ) ) );
	}
	return 1.0 - blkFacing * ( 1.0 - blkLit * ( 1.0 / 12.0 ) );
}
`;

/** Ahead of three's indirect diffuse: the light that is not the sun's or the fill's, kept off what the dome cannot see. */
const DOME_APPLY = /* glsl */ `
if ( uBlkDomeOn > 0.5 ) irradiance *= blkDome( geometryPosition, geometryNormal );
`;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

/** Adds a sample into the half-float mean by blending: the blend's constant alpha is 1/k. */
const ADD_FRAG = /* glsl */ `
uniform sampler2D tSample;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D( tSample, vUv );
}`;

/** Adds a sample into an eight-bit mean, from the other buffer, dithering the step so rounding does not drift. */
const ADD8_FRAG = /* glsl */ `
uniform sampler2D tSample;
uniform sampler2D tMean;
uniform float uK;
uniform float uSeed;
varying vec2 vUv;
void main() {
  vec4 m = mix( texture2D( tMean, vUv ), texture2D( tSample, vUv ), 1.0 / uK );
  float n = fract( sin( dot( gl_FragCoord.xy + uSeed, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  gl_FragColor = m + ( n - 0.5 ) / 255.0;
}`;

/**
 * The canvas: the fast frame and the mean, the mean's share growing to all of
 * it. Half a level of fixed screen-space noise keeps the long, faint
 * gradients of the settled shadows from banding in eight bits; it is scaled
 * by coverage so the page round the model stays clean.
 */
const SHOW_FRAG = /* glsl */ `
uniform sampler2D tFast;
uniform sampler2D tMean;
uniform float uW;
uniform vec2 uSize;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec4 c = mix( texture2D( tFast, uv ), texture2D( tMean, uv ), uW );
  float n = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) - 0.5;
  c.rgb = clamp( c.rgb + n * ( 1.0 / 255.0 ) * c.a, 0.0, c.a );
  gl_FragColor = c;
}`;

function quad(frag: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
}

const FLIP: Record<THREE.Side, THREE.Side> = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };

/** One sample's lights. */
export interface SampleLights {
  /** The sun's direction for this sample, toward it, world. */
  sun: THREE.Vector3;
  /** The dome light's direction, toward it, world. */
  dome: THREE.Vector3;
}

export class Settle {
  readonly uniforms: DomeUniforms = {
    uBlkDomeOn: { value: 0 },
    uBlkDomeMap: { value: null },
    uBlkDomeShadow: { value: null },
    uBlkDomeMatrix: { value: new THREE.Matrix4() },
    uBlkDomeDir: { value: new THREE.Vector3(0, 1, 0) },
    uBlkDomeSoft: { value: new THREE.Vector4(1, 0.02, 0, 0.1) },
    uBlkDomeScale: { value: new THREE.Vector3(1, 1, 0) },
    uBlkDomeSpin: { value: new THREE.Vector2(1, 0) }
  };
  /** Samples in the mean. */
  count = 0;
  /** Samples wanted. */
  target: number;
  /** The mean's share of what is on screen, 0 to 1. */
  private weight = 0;
  private base: number;
  /** Set by a caller: exactly this many samples, with no timing. */
  private fixed: number | null = null;
  private began = false;
  private lastAt = 0;
  private spent = 0;
  private timed = 0;

  private renderer: THREE.WebGLRenderer;
  private half: boolean;
  private size = new THREE.Vector2();
  private fast: THREE.FramebufferTexture | null = null;
  private sample: THREE.FramebufferTexture | null = null;
  private means: THREE.WebGLRenderTarget[] = [];
  private flip = 0;

  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera();
  private quadMesh: THREE.Mesh;
  private add: THREE.ShaderMaterial;
  private add8: THREE.ShaderMaterial;
  private screen: THREE.ShaderMaterial;

  private domeTarget: THREE.WebGLRenderTarget;
  private domeCam = new THREE.OrthographicCamera();
  private domeScene = new THREE.Scene();
  private proxies = new Map<THREE.Mesh, THREE.Mesh>();
  private depth: Record<THREE.Side, THREE.MeshDepthMaterial>;
  private bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  private saved = new THREE.Matrix4();
  private keep = new THREE.Color();

  constructor(renderer: THREE.WebGLRenderer, coarse: boolean) {
    this.renderer = renderer;
    this.base = coarse ? SAMPLES_COARSE : SAMPLES_FINE;
    this.target = this.base;
    const ext = renderer.extensions;
    this.half = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.add = quad(ADD_FRAG, { tSample: { value: null } });
    this.add.blending = THREE.CustomBlending;
    this.add.blendEquation = this.add.blendEquationAlpha = THREE.AddEquation;
    this.add.blendSrc = this.add.blendSrcAlpha = THREE.ConstantAlphaFactor;
    this.add.blendDst = this.add.blendDstAlpha = THREE.OneMinusConstantAlphaFactor;
    this.add8 = quad(ADD8_FRAG, { tSample: { value: null }, tMean: { value: null }, uK: { value: 1 }, uSeed: { value: 0 } });
    this.add8.blending = THREE.NoBlending;
    this.screen = quad(SHOW_FRAG, { tFast: { value: null }, tMean: { value: null }, uW: { value: 0 }, uSize: { value: new THREE.Vector2(1, 1) } });
    this.screen.blending = THREE.NoBlending;
    this.quadMesh = new THREE.Mesh(geo, this.screen);
    this.quadMesh.frustumCulled = false;
    this.quadScene.add(this.quadMesh);

    // Depth twice over: packed in the colour, read exactly, to find what shades a point; and as a depth
    // texture compared in hardware, each read already a bilinear blend of four, for the blur.
    const depthTex = new THREE.DepthTexture(DOME_SIZE, DOME_SIZE);
    depthTex.compareFunction = THREE.LessEqualCompare;
    depthTex.minFilter = depthTex.magFilter = THREE.LinearFilter;
    this.domeTarget = new THREE.WebGLRenderTarget(DOME_SIZE, DOME_SIZE, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthTexture: depthTex });
    this.domeTarget.texture.generateMipmaps = false;
    this.bindDome();
    const depth = (side: THREE.Side) => {
      const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      m.side = side;
      return m;
    };
    this.depth = { [THREE.FrontSide]: depth(THREE.FrontSide), [THREE.BackSide]: depth(THREE.BackSide), [THREE.DoubleSide]: depth(THREE.DoubleSide) };
    this.domeScene.matrixWorldAutoUpdate = false;
  }

  /** Whether a settle has begun and not finished. */
  get busy(): boolean {
    return this.began && this.count < this.target;
  }

  get done(): boolean {
    return this.began && this.count >= this.target;
  }

  /** Exactly n samples from now on, as for a test harness on a slow software renderer; null goes back to the device's own count. */
  setSamples(n: number | null): void {
    this.fixed = n !== null && n > 0 ? Math.max(1, Math.round(n)) : null;
    this.target = this.fixed ?? this.base;
  }

  /** Drops the mean: something changed. */
  reset(): void {
    this.began = false;
    this.count = 0;
    this.weight = 0;
    this.lastAt = 0;
    this.spent = 0;
    this.timed = 0;
    this.target = this.fixed ?? this.base;
  }

  /**
   * Makes every lit material under `root` read the dome. Each keeps its own
   * shader and gains a uniform-guarded lookup, so the fast pass pays nothing
   * but the branch; done once per material, before it is first drawn.
   */
  adopt(root: THREE.Object3D): void {
    const seen = new Set<THREE.Material>();
    root.traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      if (!mats) return;
      for (const m of Array.isArray(mats) ? mats : [mats]) if (!seen.has(m)) seen.add(m), this.adoptMaterial(m);
    });
  }

  private adoptMaterial(mat: THREE.Material): void {
    const lit = (mat as THREE.MeshLambertMaterial).isMeshLambertMaterial || (mat as THREE.MeshStandardMaterial).isMeshStandardMaterial || (mat as THREE.MeshPhongMaterial).isMeshPhongMaterial;
    if (!lit || mat.userData.blkDome) return;
    mat.userData.blkDome = true;
    const before = mat.onBeforeCompile;
    // A material left with three's default key is keyed by its compile hook's source, which is about to change.
    const own = mat.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey ? before.toString() : null;
    const key = mat.customProgramCacheKey.bind(mat);
    const u = this.uniforms;
    mat.onBeforeCompile = (shader, renderer) => {
      before.call(mat, shader, renderer);
      if (!shader.fragmentShader.includes('#include <packing>') || !shader.fragmentShader.includes('#include <lights_fragment_end>')) return;
      Object.assign(shader.uniforms, u);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <packing>', '#include <packing>\n' + DOME_PARS)
        .replace('#include <lights_fragment_end>', DOME_APPLY + '#include <lights_fragment_end>');
    };
    mat.customProgramCacheKey = () => (own ?? key()) + '|blk-dome';
    mat.needsUpdate = true;
  }

  /** The lights for sample k (from 1): the sun within its disc round `sun`, and the dome within its cone. */
  lights(k: number, sun: THREE.Vector3, out: SampleLights): SampleLights {
    // The sun: area-uniform over the disc, from an R2 sequence.
    const su = frac(0.5 + k * R2A);
    const sv = frac(0.5 + k * R2B);
    const r = Math.sqrt(su) * SUN_DISC * (Math.PI / 180);
    const a = sv * Math.PI * 2;
    const d = sun.clone().normalize();
    const t1 = new THREE.Vector3(0, 1, 0).cross(d);
    if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0);
    t1.normalize();
    const t2 = d.clone().cross(t1);
    out.sun.copy(d).addScaledVector(t1, Math.tan(r) * Math.cos(a)).addScaledVector(t2, Math.tan(r) * Math.sin(a)).normalize();
    // The dome: cosine-weighted over the cone, from a second R2 sequence offset from the sun's.
    const du = frac(0.21 + k * R2B);
    const dv = frac(0.73 + k * R2A);
    const s2 = du * Math.sin((DOME_CONE * Math.PI) / 180) ** 2;
    const st = Math.sqrt(s2);
    const ct = Math.sqrt(1 - s2);
    const phi = dv * Math.PI * 2;
    out.dome.set(st * Math.cos(phi), ct, st * Math.sin(phi));
    // The blur's taps turn by the golden angle from one sample to the next.
    this.uniforms.uBlkDomeSpin.value.set(Math.cos(k * 2.39996323), Math.sin(k * 2.39996323));
    return out;
  }

  /**
   * Draws the dome's shadow map for a direction, fitted round these world
   * points, from every visible mesh that casts a shadow and sits on one of
   * the dome camera's layers (the flat's ceiling is kept off them). `reach` is
   * how far a shadow that matters can fall, metres: the model's height.
   */
  renderDome(scene: THREE.Scene, dir: THREE.Vector3, pts: THREE.Vector3[], reach: number): void {
    this.syncCasters(scene);
    const cam = this.domeCam;
    const centre = new THREE.Vector3();
    for (const p of pts) centre.add(p);
    centre.multiplyScalar(1 / Math.max(1, pts.length));
    let far = 0;
    for (const p of pts) far = Math.max(far, p.distanceTo(centre));
    cam.position.copy(centre).addScaledVector(dir, far + 5);
    cam.up.set(0, 0, -1);
    cam.lookAt(centre);
    cam.updateMatrixWorld();
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
    const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const v = new THREE.Vector3();
    for (const p of pts) {
      v.copy(p).applyMatrix4(cam.matrixWorldInverse);
      lo.min(v);
      hi.max(v);
    }
    cam.left = lo.x;
    cam.right = hi.x;
    cam.bottom = lo.y;
    cam.top = hi.y;
    cam.near = Math.max(0.05, -hi.z - 0.5);
    cam.far = -lo.z + 0.5;
    cam.updateProjectionMatrix();

    const r = this.renderer;
    const target = r.getRenderTarget();
    r.getClearColor(this.keep);
    const alpha = r.getClearAlpha();
    r.setRenderTarget(this.domeTarget);
    // Cleared to the far plane, which unpacks as nothing in the way.
    r.setClearColor(0xffffff, 1);
    r.clear();
    r.render(this.domeScene, cam);
    r.setRenderTarget(target);
    r.setClearColor(this.keep, alpha);

    const w = hi.x - lo.x;
    const h = hi.y - lo.y;
    const range = cam.far - cam.near;
    const texel = Math.max(w, h) / DOME_SIZE;
    // Neighbouring samples are this far apart, as the tangent of an angle: the cone's projected area shared out.
    const apart = Math.sin((DOME_CONE * Math.PI) / 180) * Math.sqrt(Math.PI / Math.max(1, this.target));
    const blur = apart * DOME_BLUR;
    const u = this.uniforms;
    u.uBlkDomeMatrix.value.copy(this.bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    u.uBlkDomeDir.value.copy(dir).normalize();
    u.uBlkDomeSoft.value.set(range, texel * 1.5, blur, Math.max(texel * 3, reach * blur));
    u.uBlkDomeScale.value.set(1 / w, 1 / h, (texel * 0.5) / range);
  }

  /** Mirrors the scene's shadow casters into the dome's own scene, sharing their geometry and depth materials. */
  private syncCasters(scene: THREE.Scene): void {
    const layers = this.domeCam.layers;
    const live = new Set<THREE.Mesh>();
    scene.updateMatrixWorld();
    scene.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.castShadow || !m.layers.test(layers)) return;
      const mat = m.material as THREE.Material;
      if (Array.isArray(m.material) || !mat.visible) return;
      live.add(m);
      let p = this.proxies.get(m);
      if (!p) {
        p = new THREE.Mesh();
        p.matrixAutoUpdate = false;
        p.matrixWorldAutoUpdate = false;
        this.proxies.set(m, p);
        this.domeScene.add(p);
      }
      p.geometry = m.geometry;
      const custom = m.customDepthMaterial;
      // As three's own shadow pass does: the far side of a one-sided surface, so it does not shade itself.
      const side = mat.shadowSide ?? FLIP[mat.side];
      if (custom) custom.side = side;
      p.material = custom ?? this.depth[side];
      p.matrixWorld.copy(m.matrixWorld);
      p.frustumCulled = m.frustumCulled;
    });
    for (const [m, p] of this.proxies) {
      if (live.has(m)) continue;
      this.domeScene.remove(p);
      this.proxies.delete(m);
    }
  }

  /**
   * Begins a settle from the frame that is on the canvas now: keeps it to
   * blend from. Call straight after drawing that frame, in the same task.
   */
  begin(): void {
    this.reset();
    this.ensure();
    this.renderer.copyFramebufferToTexture(this.fast!);
    this.began = true;
  }

  /** Draws one jittered sample of the scene to the canvas and keeps it: the canvas is overwritten by show() before it is seen. */
  draw(scene: THREE.Scene, camera: THREE.PerspectiveCamera, k: number): void {
    const P = camera.projectionMatrix;
    this.saved.copy(P);
    // A Gaussian spread of sub-pixel offsets from the Halton sequence, by Box-Muller.
    const u = Math.max(1e-6, halton(k, 2));
    const v = halton(k, 3);
    const rad = Math.min(2.5, Math.sqrt(-2 * Math.log(u))) * JITTER;
    P.elements[8] += (2 * rad * Math.cos(2 * Math.PI * v)) / this.size.x;
    P.elements[9] += (2 * rad * Math.sin(2 * Math.PI * v)) / this.size.y;
    camera.projectionMatrixInverse.copy(P).invert();
    const r = this.renderer;
    r.setRenderTarget(null);
    r.render(scene, camera);
    P.copy(this.saved);
    camera.projectionMatrixInverse.copy(P).invert();
    r.copyFramebufferToTexture(this.sample!);
  }

  /** Adds the sample just drawn into the mean, and moves the mean's share of the screen on. */
  accumulate(): void {
    const r = this.renderer;
    this.count++;
    const k = this.count;
    const auto = r.autoClear;
    r.autoClear = false;
    if (this.half) {
      this.add.uniforms.tSample.value = this.sample;
      this.add.blendAlpha = 1 / k;
      this.quadMesh.material = this.add;
      r.setRenderTarget(this.means[0]);
    } else {
      const from = this.means[this.flip];
      this.flip = 1 - this.flip;
      this.add8.uniforms.tSample.value = this.sample;
      this.add8.uniforms.tMean.value = from.texture;
      this.add8.uniforms.uK.value = k;
      this.add8.uniforms.uSeed.value = (k * 37.17) % 101;
      this.quadMesh.material = this.add8;
      r.setRenderTarget(this.means[this.flip]);
    }
    r.render(this.quadScene, this.quadCam);
    r.setRenderTarget(null);
    r.autoClear = auto;
    // The share grows evenly to all of it at the last sample, and stays continuous if the count is cut on the way.
    this.weight += (1 - this.weight) / Math.max(1, this.target - k + 1);
    if (k >= this.target) this.weight = 1;
  }

  /** Puts the fast frame and the mean, blended, on the canvas. */
  show(): void {
    const r = this.renderer;
    const s = this.screen.uniforms;
    s.tFast.value = this.fast;
    s.tMean.value = this.means[this.half ? 0 : this.flip].texture;
    s.uW.value = this.weight;
    (s.uSize.value as THREE.Vector2).copy(this.size);
    this.quadMesh.material = this.screen;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }

  /**
   * Timing, once per sample with the frame's timestamp: on a device that
   * cannot reach the count in the budget, the count is cut to what fits.
   * Frames far apart (a hidden tab, a stall) are left out of the measure.
   */
  note(now: number): void {
    if (this.lastAt > 0) {
      const dt = now - this.lastAt;
      if (dt > 0 && dt < 400) {
        this.spent += dt;
        this.timed++;
      }
    }
    this.lastAt = now;
    if (this.fixed !== null || this.timed < 3) return;
    const per = this.spent / this.timed;
    const fit = Math.max(SAMPLES_MIN, Math.floor(BUDGET_MS / per));
    this.target = Math.max(this.count + 1, Math.min(this.target, fit));
  }

  /** Forgets frame timing, as after the tab was hidden. */
  pause(): void {
    this.lastAt = 0;
  }

  /** Buffers for the canvas as it is now. */
  private ensure(): void {
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    if (size.equals(this.size) && this.fast) return;
    this.size.copy(size);
    this.fast?.dispose();
    this.sample?.dispose();
    for (const m of this.means) m.dispose();
    const w = Math.max(1, size.x);
    const h = Math.max(1, size.y);
    this.fast = new THREE.FramebufferTexture(w, h);
    this.sample = new THREE.FramebufferTexture(w, h);
    const opts = { depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false };
    this.means = this.half
      ? [new THREE.WebGLRenderTarget(w, h, { ...opts, type: THREE.HalfFloatType })]
      : [new THREE.WebGLRenderTarget(w, h, opts), new THREE.WebGLRenderTarget(w, h, opts)];
    this.flip = 0;
  }

  /** Bytes held for settling at the canvas's current size, for the stats. */
  memory(): number {
    const px = this.size.x * this.size.y;
    return px * (4 + 4 + (this.half ? 8 : 8)) + DOME_SIZE * DOME_SIZE * 8;
  }

  /** After the context was lost: the buffers are recreated when next used. */
  restored(): void {
    this.size.set(0, 0);
    this.bindDome();
    this.reset();
  }

  /**
   * The dome's map made on the GPU and bound to every lit material at once,
   * though it is not drawn until a settle: a shadow sampler whose texture does
   * not exist yet fails every draw that declares it, the fast pass's included.
   */
  private bindDome(): void {
    this.renderer.initRenderTarget(this.domeTarget);
    this.uniforms.uBlkDomeMap.value = this.domeTarget.texture;
    this.uniforms.uBlkDomeShadow.value = this.domeTarget.depthTexture;
  }

  dispose(): void {
    this.fast?.dispose();
    this.sample?.dispose();
    for (const m of this.means) m.dispose();
    this.domeTarget.depthTexture?.dispose();
    this.domeTarget.dispose();
    this.add.dispose();
    this.add8.dispose();
    this.screen.dispose();
    this.quadMesh.geometry.dispose();
    for (const m of Object.values(this.depth)) m.dispose();
    this.proxies.clear();
  }
}
