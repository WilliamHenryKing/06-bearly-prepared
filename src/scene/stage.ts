import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { EnvironmentBaker, hazeRadiance, SkyDome, skyAmbient } from "./render/sky";
import { type Celestial, celestial } from "./render/sky-model";

// One lighting model (after ODD TIDE's rig and pipeline, reused with permission): a physical sky
// dome and a sun in lux, the same sky baked to a PMREM environment, aerial perspective tinted
// with the sky's own horizon radiance, and a single pre-exposure. Scene values are pre-exposed;
// Neutral tone mapping and the sRGB transfer happen once, in OutputPass.

/** A warm mid-afternoon. */
export const HOUR = 17.4;
/** Meteorological visibility for the aerial perspective, metres (a hazy summer valley). */
const VISIBILITY = 4000;
const SHADOW_RADIUS = 9;

export type Tier = "high" | "low";

let fogPatched = false;
function patchFog() {
  if (fogPatched) return;
  fogPatched = true;
  // Exponential extinction over true view distance, not depth.
  THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
  vFogDepth = length( mvPosition.xyz );
#endif`;
  THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 900);
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
  private keyLux: number;
  private shift = { x: 0, y: 0 };
  private pixelRatio: number;
  private readonly sunDir = new THREE.Vector3();
  width = 1;
  height = 1;

  constructor(canvas: HTMLCanvasElement, mobile: boolean) {
    patchFog();
    this.tier = mobile ? "low" : "high";
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: "high-performance",
      stencil: false,
    });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
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
    const baker = new EnvironmentBaker(this.renderer);
    this.scene.environment = baker.bake(sky, 0, ambient);

    this.sunDir.set(...sky.sun.direction).normalize();
    this.keyLux = sky.sunLux * sky.preExposure;
    this.key.color.setRGB(...sky.sunColour);
    this.key.intensity = this.keyLux;
    this.key.castShadow = true;
    const size = mobile ? 1024 : 2048;
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
    this.scene.fog = new THREE.FogExp2(
      new THREE.Color(haze[0] * p, haze[1] * p, haze[2] * p),
      3.912 / VISIBILITY,
    );

    // Post: HDR (MSAA on the high tier) → GTAO → thresholded bloom → OutputPass → SMAA.
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: this.tier === "high" ? 4 : 0,
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
    this.ao.enabled = this.tier === "high";
    this.composer.addPass(this.ao);
    // Glare only from energy above a high threshold: the lit lamp and the sun's glints.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.12, 0.2, 2.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new SMAAPass());
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

  /** Drop to the lighter tier (no GTAO, lower resolution) when frames run long. */
  degrade() {
    if (this.ao.enabled) {
      this.ao.enabled = false;
      return true;
    }
    for (const step of this.degradeSteps) if (step()) return true;
    if (this.pixelRatio > 1) {
      this.pixelRatio = 1;
      this.resize(this.width, this.height);
      return true;
    }
    return false;
  }

  resize(w: number, h: number) {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(this.pixelRatio);
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
