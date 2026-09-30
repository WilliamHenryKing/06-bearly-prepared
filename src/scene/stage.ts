import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { type QualityTier, TIERS } from "./quality";
import {
  EnvironmentBaker,
  hazeRadiance,
  type Panorama,
  type SkyAmbient,
  SkyDome,
  skyAmbient,
} from "./render/sky";
import { type Celestial, celestial } from "./render/sky-model";

// One lighting model (after ODD TIDE's rig and pipeline, reused with permission): a physical sky
// dome and a sun in lux, the same sky baked to a PMREM environment, aerial perspective tinted
// with the sky's own horizon radiance, and a single pre-exposure. Scene values are pre-exposed;
// Neutral tone mapping and the sRGB transfer happen once, in OutputPass.

/** A warm mid-afternoon. */
export const HOUR = 17.4;
/** Meteorological visibility for the aerial perspective, metres (a hazy summer valley). */
const VISIBILITY = 38000;
/** Scale height of the haze (metres): the air near the valley floor is the densest. */
const FOG_SCALE = 900;
const SHADOW_RADIUS = 9;

export type Tier = "high" | "low";

/**
 * Zeroes NaN and infinity (all exponent bits set: immune to fast-math) and caps HDR values
 * before bloom. Some GPUs (Apple's) make NaN where others quietly don't, and bloom's blur
 * would spread one bad pixel over the whole frame.
 */
const FiniteShader = {
  name: "FiniteShader",
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    float finite(float x) {
      return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u ? 0.0 : clamp(x, 0.0, 16384.0);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      gl_FragColor = vec4(finite(c.r), finite(c.g), finite(c.b), 1.0);
    }`,
};

let fogPatched = false;
/**
 * @param sunFlat the sun's bearing (unit, x/z)
 * @param sunTint how much brighter and warmer the horizon haze is toward the sun than away
 */
function patchFog(sunFlat: [number, number], sunTint: [number, number, number]) {
  if (fogPatched) return;
  fogPatched = true;
  const v2 = (v: number[]) => v.map((x) => x.toFixed(4)).join(", ");
  // Aerial perspective: exponential extinction over the true view distance, in air that thins
  // with height (scale height FOG_SCALE m), using the average density along each view ray. The
  // valley floor recedes into haze while the peaks above it stand out.
  THREE.ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG
  varying float vFogDepth;
  varying float vFogHeight;
  varying vec3 vFogDir;
#endif`;
  THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
  vFogDepth = length( mvPosition.xyz );
  vFogHeight = ( transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) ).y;
  vFogDir = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying float vFogHeight;
  varying vec3 vFogDir;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogH = ${FOG_SCALE.toFixed(1)};
    float fogDh = vFogHeight - cameraPosition.y;
    float fogAvg = abs( fogDh ) > 1.0
      ? fogH * ( exp( -max( cameraPosition.y, 0.0 ) / fogH ) - exp( -max( vFogHeight, 0.0 ) / fogH ) ) / fogDh
      : exp( -max( cameraPosition.y, 0.0 ) / fogH );
    float fogFactor = 1.0 - exp( - fogDensity * vFogDepth * fogAvg );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  // Toward the sun the haze glows brighter and warmer (forward scattering off the aerosol).
  vec2 fogFlat = normalize( vFogDir.xz + vec2( 1e-6 ) );
  float fogSun = pow( max( dot( fogFlat, vec2( ${v2(sunFlat)} ) ), 0.0 ), 2.0 );
  vec3 fogCol = fogColor * mix( vec3( 1.0 ), vec3( ${v2(sunTint)} ), fogSun );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
#endif`;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.12, 9000);
  readonly key = new THREE.DirectionalLight(0xffffff, 1);
  readonly sky = new SkyDome({ cloudCoverage: 0.34 });
  readonly sun: Celestial;
  /** Multiply physical luminance (cd/m²) or intensity (cd) by this to get scene units. */
  readonly preExposure: number;
  readonly composer: EffectComposer;
  readonly ao: GTAOPass;
  readonly bloom: UnrealBloomPass;
  /** Objects GTAO's G-buffer should skip (sky, effects). */
  aoHidden: THREE.Object3D[] = [];
  /** Extra quality steps between dropping GTAO and dropping resolution (false when spent). */
  degradeSteps: (() => boolean)[] = [];
  tier: Tier;
  readonly quality: QualityTier;
  private keyLux: number;
  private shift = { x: 0, y: 0 };
  private pixelRatio: number;
  /** Resolution scale the frame-time governor may lower (to 0.6), on top of the pixel budget. */
  private renderScale = 1;
  /** Toward the sun (unit). */
  readonly sunDir = new THREE.Vector3();
  private baker: EnvironmentBaker;
  private ambient: SkyAmbient;
  width = 1;
  height = 1;

  constructor(
    canvas: HTMLCanvasElement,
    mobile: boolean,
    quality: QualityTier = {
      quality: mobile ? "low" : "high",
      ...TIERS[mobile ? "low" : "high"],
    },
  ) {
    this.quality = quality;
    {
      const sky = celestial(HOUR);
      const s = sky.sun.direction;
      const l = Math.hypot(s[0], s[2]) || 1;
      const flat: [number, number] = [s[0] / l, s[2] / l];
      const toward = hazeRadiance(sky, flat);
      const away = hazeRadiance(sky, [-flat[0], -flat[1]]);
      const tint = [0, 1, 2].map((i) =>
        Math.min(4, Math.max(1, (toward[i] ?? 1) / (away[i] ?? 1))),
      ) as [number, number, number];
      patchFog(flat, tint);
    }
    this.tier = mobile ? "low" : "high";
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: "high-performance",
      stencil: false,
    });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    // Sky, sun and environment from one atmosphere, at one hour.
    const sky = celestial(HOUR);
    this.sun = sky;
    this.preExposure = sky.preExposure;
    const ambient = skyAmbient(sky);
    this.sky.apply(sky, 0, ambient);
    this.scene.add(this.sky.mesh);
    this.aoHidden.push(this.sky.mesh);
    this.baker = new EnvironmentBaker(this.renderer);
    this.ambient = ambient;
    this.scene.environment = this.baker.bake(sky, 0, ambient);

    this.sunDir.set(...sky.sun.direction).normalize();
    this.keyLux = sky.sunLux * sky.preExposure;
    this.key.color.setRGB(...sky.sunColour);
    this.key.intensity = this.keyLux;
    this.key.castShadow = true;
    const size = quality.shadow;
    this.key.shadow.mapSize.set(size, size);
    const sc = this.key.shadow.camera;
    sc.left = sc.bottom = -SHADOW_RADIUS;
    sc.right = sc.top = SHADOW_RADIUS;
    sc.near = 0.5;
    sc.far = SHADOW_RADIUS * 6;
    const texel = (2 * SHADOW_RADIUS) / size;
    this.key.shadow.normalBias = texel * 0.9;
    this.key.shadow.bias = -0.00015;
    this.key.shadow.radius = 2;
    this.scene.add(this.key, this.key.target);

    const haze = hazeRadiance(sky, [-this.sunDir.x, -this.sunDir.z]);
    const p = sky.preExposure;
    // Distance takes on the sky's blue (the haze is lit by the whole sky, not only the sun).
    this.scene.fog = new THREE.FogExp2(
      new THREE.Color(haze[0] * p * 0.74, haze[1] * p * 0.92, haze[2] * p * 1.32),
      3.912 / VISIBILITY,
    );

    // Post: HDR (MSAA on the high tier) → GTAO → finite → thresholded bloom → OutputPass → SMAA.
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: quality.msaa,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = new GTAOPass(this.scene, this.camera, 1, 1);
    this.ao.blendIntensity = 0.9;
    this.ao.updateGtaoMaterial({
      radius: 0.45,
      distanceExponent: 1.4,
      thickness: 1,
      scale: 1,
      samples: 12,
    });
    this.ao.updatePdMaterial({
      lumaPhi: 10,
      depthPhi: 2,
      normalPhi: 3,
      radius: 5,
      rings: 2,
      samples: 10,
    });
    const patched = this.ao as unknown as {
      _overrideVisibility(): void;
      _visibilityCache: THREE.Object3D[];
    };
    const original = patched._overrideVisibility.bind(this.ao);
    patched._overrideVisibility = () => {
      original();
      for (const o of this.aoHidden)
        if (o.visible) {
          o.visible = false;
          patched._visibilityCache.push(o);
        }
    };
    // GTAO's pre-pass re-renders the scene; the scene pass has already drawn the shadow map.
    const aoRender = this.ao.render.bind(this.ao);
    this.ao.render = ((...args: Parameters<GTAOPass["render"]>) => {
      const shadows = this.renderer.shadowMap;
      const auto = shadows.autoUpdate;
      shadows.autoUpdate = false;
      try {
        aoRender(...args);
      } finally {
        shadows.autoUpdate = auto;
      }
    }) as GTAOPass["render"];
    this.ao.enabled = quality.ao;
    this.composer.addPass(this.ao);
    this.composer.addPass(new ShaderPass(FiniteShader));
    // Glare only from energy above a high threshold: the lit lamp and the sun's glints.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.12, 0.2, 2.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new SMAAPass());
  }

  /** Swap the live sky for the baked, path-traced one, and light the scene from it. */
  setSkyPanorama(visible: THREE.Texture, forLight: THREE.Texture, pano: Panorama) {
    this.sky.setPanorama(visible, pano);
    this.baker.setPanorama(forLight, pano);
    this.scene.environment = this.baker.bake(this.sun, 0, this.ambient);
  }

  /** Dim the sun for a solemn moment (0 … 1). */
  hush(k: number) {
    this.key.intensity = this.keyLux * (1 - 0.45 * k);
  }

  /** Keep the shadow frustum on the subject, snapped to whole shadow texels so it never swims. */
  follow(target: THREE.Vector3) {
    const d = this.sunDir;
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), d).normalize();
    const up = new THREE.Vector3().crossVectors(d, right);
    const texel = (2 * SHADOW_RADIUS) / this.key.shadow.mapSize.x;
    const a = Math.round(target.dot(right) / texel) * texel;
    const b = Math.round(target.dot(up) / texel) * texel;
    const c = target.dot(d);
    const snapped = right.multiplyScalar(a).addScaledVector(up, b).addScaledVector(d, c);
    this.key.target.position.copy(snapped);
    this.key.position.copy(snapped).addScaledVector(d, SHADOW_RADIUS * 3);
  }

  setShift(x: number, y: number) {
    this.shift = { x, y };
    this.applyView();
  }

  /**
   * One step lighter when frames run long: GTAO, then the scene's own steps (fur, grass), then
   * multisampling (SMAA still smooths edges), then resolution: device pixels down to one per
   * CSS pixel, then down to 60 % of that in tenths.
   */
  degrade() {
    if (this.ao.enabled) {
      this.ao.enabled = false;
      return true;
    }
    for (const step of this.degradeSteps) if (step()) return true;
    const targets = [this.composer.renderTarget1, this.composer.renderTarget2];
    if (targets.some((t) => t.samples > 0)) {
      for (const t of targets) {
        t.samples = 0;
        t.dispose();
      }
      return true;
    }
    if (this.pixelRatio > 1) {
      this.pixelRatio = 1;
      this.resize(this.width, this.height);
      return true;
    }
    if (this.renderScale > 0.65) {
      this.renderScale = Math.max(0.6, this.renderScale - 0.1);
      this.resize(this.width, this.height);
      return true;
    }
    return false;
  }

  /** Where the frame-time governor has got to, for evidence and tests. */
  get state() {
    return {
      quality: this.quality.quality,
      ao: this.ao.enabled,
      msaa: this.composer.renderTarget1.samples,
      pixelRatio: +this.renderer.getPixelRatio().toFixed(3),
      renderScale: +this.renderScale.toFixed(2),
    };
  }

  /**
   * Compile every shader the scene needs before its first full frame: in parallel where the
   * browser allows (KHR_parallel_shader_compile), and for the HDR target the scene pass draws
   * into, whose programs differ from on-screen ones (no tone mapping, linear output). `later`
   * holds things that join the scene in play (the load's props), compiled against its lights.
   * Then everything is drawn once with culling off, so the driver finishes each program for the
   * vertex layouts, passes and targets it will really meet (ANGLE builds its D3D shaders at the
   * first draw), while the arrival veil still hides the canvas: nothing stalls later, when a
   * villager first walks into view.
   */
  async precompile(later?: THREE.Object3D) {
    const r = this.renderer;
    const previous = r.getRenderTarget();
    r.setRenderTarget(this.composer.readBuffer);
    const jobs = [r.compileAsync(this.scene, this.camera)];
    if (later) jobs.push(r.compileAsync(later, this.camera, this.scene));
    r.setRenderTarget(previous);
    await Promise.all(jobs);
    if (later) this.scene.add(later);
    const culled: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (o.frustumCulled) {
        o.frustumCulled = false;
        culled.push(o);
      }
    });
    this.composer.render();
    for (const o of culled) o.frustumCulled = true;
    if (later) {
      this.scene.remove(later);
      later.traverse((o) => {
        (o as THREE.Mesh).geometry?.dispose();
      });
    }
  }

  resize(w: number, h: number) {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    // Within the tier's pixel budget (a high-density screen need not draw every device pixel).
    const budget = Math.sqrt(this.quality.pixelBudget / (this.width * this.height));
    const ratio = Math.min(this.pixelRatio, budget) * this.renderScale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.fov = this.camera.aspect < 0.8 ? 58 : 42;
    this.applyView();
  }

  private applyView() {
    const { width: w, height: h } = this;
    if (this.shift.x || this.shift.y)
      this.camera.setViewOffset(w, h, this.shift.x, this.shift.y, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.composer.render();
  }
}
