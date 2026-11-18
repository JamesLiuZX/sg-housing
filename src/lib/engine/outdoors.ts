import * as THREE from 'three';
import type { RGB, SkyStops } from './sky';

/**
 * What the windows look out on while walking, in two cheap pieces.
 *
 * The sky is one triangle over the screen, drawn after everything solid and
 * only where nothing else was, so it costs only the pixels seen through the
 * glass. Its colours are the page's own for the hour (sky.ts), brightest at
 * the horizon and deepening overhead, so the view out and the page round the
 * model never disagree, with a soft glow and a small disc where the sun is.
 *
 * The site's shadow: the shared shadow map is fitted tightly round the flat,
 * which is what keeps its sun patches sharp, and is far too small to hold the
 * blocks outside. So the site gets a map of its own, drawn again only when the
 * sun or the site moves.
 */

/** The layer the site's solid mesh is also on, so its shadow can be drawn without the flat. */
const SHADOW_LAYER = 5;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  // On the far plane, so the depth test leaves it only the pixels nothing else has covered.
  gl_Position = vec4(position.xy, 1.0, 1.0);
  vec4 v = inverse(projectionMatrix) * vec4(position.xy, 1.0, 1.0);
  vDir = transpose(mat3(viewMatrix)) * (v.xyz / v.w);
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uHorizon;
uniform vec3 uMid;
uniform vec3 uZenith;
uniform vec3 uBelow;
uniform vec3 uSunDir;
uniform vec3 uSunGlow;
uniform vec3 uSunDisc;
uniform float uSunUp;
uniform float uOpacity;
varying vec3 vDir;
#include <common>
#include <dithering_pars_fragment>
void main() {
  vec3 d = normalize(vDir);
  float e = d.y;
  // Most of what a window shows is the first twenty degrees of sky, so the tone changes there.
  vec3 c = mix(uHorizon, uMid, smoothstep(0.0, 0.2, e));
  c = mix(c, uZenith, smoothstep(0.12, 0.75, e));
  // Under the horizon, where the site's ground has faded out or there is no site at all.
  c = mix(c, uBelow, 1.0 - smoothstep(-0.16, 0.0, e));
  float s = max(dot(d, uSunDir), 0.0);
  c += uSunGlow * uSunUp * (0.16 * pow(s, 24.0) + 0.3 * pow(s, 320.0));
  c = mix(c, uSunDisc, uSunUp * smoothstep(0.99974, 0.99990, s));
  gl_FragColor = vec4(c, uOpacity);
  #include <colorspace_fragment>
  #include <dithering_fragment>
}`;

const toLinear = (c: RGB, out: THREE.Color) => out.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);

export interface SkyUniforms {
  uHorizon: THREE.IUniform<THREE.Color>;
  uMid: THREE.IUniform<THREE.Color>;
  uZenith: THREE.IUniform<THREE.Color>;
  uBelow: THREE.IUniform<THREE.Color>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunGlow: THREE.IUniform<THREE.Color>;
  uSunDisc: THREE.IUniform<THREE.Color>;
  uSunUp: THREE.IUniform<number>;
  uOpacity: THREE.IUniform<number>;
}

export class Outdoors {
  /** Add to the scene; hidden until opened. */
  readonly sky: THREE.Mesh;
  readonly u: SkyUniforms;
  /** The site's own shadow map: packed depth, as three's are. */
  readonly map: THREE.WebGLRenderTarget;
  /** World to the site's shadow map. */
  readonly matrix = new THREE.Matrix4();
  /** The filter's step in map units (x, y), and the lift off a surface in metres (z). */
  readonly soft = new THREE.Vector3();
  private cam = new THREE.OrthographicCamera();
  private depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  private keep = new THREE.Color();
  private bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

  constructor(size: number) {
    this.u = {
      uHorizon: { value: new THREE.Color() },
      uMid: { value: new THREE.Color() },
      uZenith: { value: new THREE.Color() },
      uBelow: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunGlow: { value: new THREE.Color() },
      uSunDisc: { value: new THREE.Color(0xffb04d) },
      uSunUp: { value: 0 },
      uOpacity: { value: 0 }
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.u },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      depthWrite: false,
      // Blended while it fades in, yet kept among the solids so it is drawn before the glass.
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor
    });
    mat.dithering = true;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    // Last of the solids: by then the depth buffer says where the windows are.
    this.sky.renderOrder = 1000;
    this.sky.visible = false;
    this.map = new THREE.WebGLRenderTarget(size, size, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.map.texture.generateMipmaps = false;
    this.cam.layers.set(SHADOW_LAYER);
  }

  /** How far the sky has faded in, 0 to 1. */
  setOpacity(k: number): void {
    this.u.uOpacity.value = k;
    this.sky.visible = k > 0.001;
  }

  /**
   * The sky for the hour, from the page's three stops: its centre at the
   * horizon, its body higher up, its edge overhead. The ground under the
   * horizon takes the haze colour, so a site's table fades into it. `sun`
   * points at the sun in the world; `up` is 0 with it set to 1 well clear of
   * the horizon.
   */
  setSky(stops: SkyStops, haze: THREE.Color, sun: THREE.Vector3, glow: THREE.Color, up: number): void {
    const u = this.u;
    toLinear(stops[0], u.uHorizon.value);
    toLinear(stops[1], u.uMid.value);
    toLinear(stops[2], u.uZenith.value);
    u.uBelow.value.copy(haze);
    u.uSunDir.value.copy(sun).normalize();
    u.uSunGlow.value.copy(glow);
    u.uSunUp.value = up;
  }

  /**
   * Fits the site's shadow map round these world points as the sun sees
   * them. `soft` is the width of a shadow's edge, metres; the lift off each
   * surface grows with the map's texel so a wall never shades itself.
   */
  fit(pts: THREE.Vector3[], dir: THREE.Vector3, soft: number): void {
    const centre = new THREE.Vector3();
    for (const p of pts) centre.add(p);
    centre.multiplyScalar(1 / Math.max(1, pts.length));
    let reach = 0;
    for (const p of pts) reach = Math.max(reach, p.distanceTo(centre));
    const cam = this.cam;
    cam.position.copy(centre).addScaledVector(dir, reach + 20);
    // Looking straight down, "up" must not be the view direction.
    cam.up.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.92) cam.up.set(0, 0, -1);
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
    cam.near = Math.max(0.1, -hi.z - 1);
    cam.far = -lo.z + 1;
    cam.updateProjectionMatrix();
    this.matrix.copy(this.bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    const w = hi.x - lo.x;
    const h = hi.y - lo.y;
    const texel = Math.max(w, h) / this.map.width;
    const step = Math.max(texel, soft);
    this.soft.set(step / w, step / h, texel * 1.5);
  }

  /** Draws the shadow of `mesh` alone into the site's map. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, mesh: THREE.Mesh): void {
    mesh.layers.enable(SHADOW_LAYER);
    const target = renderer.getRenderTarget();
    renderer.getClearColor(this.keep);
    const alpha = renderer.getClearAlpha();
    const override = scene.overrideMaterial;
    scene.overrideMaterial = this.depth;
    renderer.setRenderTarget(this.map);
    // Cleared to the far plane, which unpacks as "nothing in the way".
    renderer.setClearColor(0xffffff, 1);
    renderer.clear();
    renderer.render(scene, this.cam);
    scene.overrideMaterial = override;
    renderer.setRenderTarget(target);
    renderer.setClearColor(this.keep, alpha);
  }

  dispose(): void {
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.map.dispose();
    this.depth.dispose();
  }
}
