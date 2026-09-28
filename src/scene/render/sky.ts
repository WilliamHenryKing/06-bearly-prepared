import {
  BackSide,
  Color,
  CubeCamera,
  HalfFloatType,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  type Texture,
  Vector3,
  WebGLCubeRenderTarget,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { ATMOSPHERE_GLSL, SOLAR_ILLUMINANCE, scatter, skyIlluminance } from "./atmosphere";
import type { Celestial, Vec3 } from "./sky-model";

// Adapted from ODD TIDE (src/world/render/sky.ts), reused with permission: the lower hemisphere
// is a sunlit meadow instead of open sea.
// The visible sky and the image-based light come from the same physical atmosphere
// (atmosphere.ts). Output is pre-exposed cd/m², so sky, sun, moon and lamps share one exposure.
// Cloud shaping follows the fbm cloud layer in three.js r186 examples/jsm/objects/Sky.js (MIT).

/** Full-moon illuminance outside the atmosphere, lux (before phase). */
export const FULL_MOON_LUX = 0.32;
export const moonTopLux = (phase: number) => FULL_MOON_LUX * phase ** 2.2;

const vertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize((modelMatrix * vec4(position, 0.0)).xyz);
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = clip.xyww;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vDirection;
  uniform vec3 sunDirection;
  uniform vec3 moonDirection;
  uniform float preExposure;
  uniform float sunDisc;
  uniform float moonLux;
  uniform float stars;
  uniform float cloudCoverage;
  uniform float time;
  uniform vec3 skyAmbient;
  uniform vec3 groundColour;
  uniform float detail;

  ${ATMOSPHERE_GLSL}

  vec2 gradient(vec2 i) {
    vec3 p = fract(i.xyx * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yzx + 33.33);
    return fract((p.xx + p.yz) * p.zy) * 2.0 - 1.0;
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = dot(gradient(i), f);
    float b = dot(gradient(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
    float c = dot(gradient(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
    float d = dot(gradient(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.6;
  }
  float fbm(vec2 p, float drift) {
    float result = 0.0;
    float amplitude = 1.0;
    for (int i = 0; i < 5; i++) {
      result += amplitude * noise(p);
      amplitude *= 0.5;
      p = p * 2.03 + drift;
    }
    return result;
  }
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec3 direction = normalize(vDirection);
    float above = direction.y;
    vec3 radiance = atmosphereScatter(direction, sunDirection, ${SOLAR_ILLUMINANCE.toFixed(1)}, 1e9);
    if (moonLux > 1e-5) radiance += atmosphereScatter(direction, moonDirection, moonLux, 1e9);
    // Airglow and distant light pollution: the faint floor of a dark coastal sky.
    radiance += vec3(0.00012, 0.00016, 0.00024) * (0.5 + 1.5 * exp(-max(above, 0.0) * 6.0));

    vec3 viewTransmittance = above > 0.0 ? atmosphereTransmittance(direction) : vec3(0.0);

    if (detail > 0.5 && above > 0.0) {
      // Stars, attenuated by the atmosphere; their visibility against the sky is left to exposure.
      if (stars > 0.001) {
        vec3 cell = floor(direction * 420.0);
        float h = hash13(cell);
        if (h > 0.9962) {
          vec3 jitter = vec3(hash13(cell + 7.0), hash13(cell + 13.0), hash13(cell + 29.0)) - 0.5;
          vec3 centre = normalize((cell + 0.5 + jitter * 0.6) / 420.0);
          float d = length(direction - centre) * 420.0;
          float magnitude = pow(hash13(cell + 3.0), 7.0);
          vec3 tint = mix(vec3(1.0, 0.82, 0.66), vec3(0.8, 0.88, 1.0), hash13(cell + 11.0));
          radiance += tint * (0.015 + 1.6 * magnitude) * smoothstep(0.55, 0.0, d) * viewTransmittance * stars;
        }
        float band = exp(-pow(dot(direction, normalize(vec3(0.3, 0.55, -0.78))) * 3.2, 2.0));
        radiance += vec3(0.0005, 0.00055, 0.0007) * band * (0.55 + 0.45 * noise(direction.xz * 30.0 + direction.y * 11.0)) * viewTransmittance * stars;
      }

      // The moon at its true angular size (0.26° radius); the phase follows the real sun direction.
      float moonCos = dot(direction, moonDirection);
      float moonRadius = 0.00454;
      if (acos(clamp(moonCos, -1.0, 1.0)) < moonRadius * 1.3 && moonDirection.y > -0.02) {
        vec3 side = normalize(cross(moonDirection, vec3(0.0, 1.0, 0.0)));
        vec3 up = normalize(cross(side, moonDirection));
        vec3 offset = direction - moonDirection * moonCos;
        vec2 local = vec2(dot(offset, side), dot(offset, up)) / moonRadius;
        float r2 = dot(local, local);
        if (r2 < 1.0) {
          vec3 normal = normalize(local.x * side + local.y * up - sqrt(1.0 - r2) * moonDirection);
          float lit = clamp(dot(normal, sunDirection) * 1.6, 0.0, 1.0);
          float maria = 0.8 + 0.2 * noise(local * 3.1 + 4.0);
          radiance += vec3(1.0, 0.97, 0.92) * (2600.0 * lit * maria + 0.05) * smoothstep(1.0, 0.94, r2) * viewTransmittance;
        }
      }
    }

    // Fair-weather cumulus lit by transmitted sunlight or moonlight plus the sky's own light.
    if (above > 0.0 && cloudCoverage > 0.0) {
      vec2 cloudUV = direction.xz / (direction.y * 0.55 + 0.04) * 0.2 + time * 0.004;
      float cloudNoise = clamp(fbm(cloudUV, time * 0.002) * 0.7 + 0.5, 0.0, 1.0);
      float coverage = clamp(cloudCoverage + noise(cloudUV * 0.3) * 0.22, 0.0, 1.0);
      float threshold = 1.0 - coverage;
      float mask = smoothstep(threshold, threshold + 0.3, cloudNoise) * smoothstep(0.0, 0.08, above);
      float depth = max(0.0, cloudNoise - threshold);
      float beer = exp(-depth * 4.0);
      float shade = mix(0.35, 1.0, clamp(beer * (1.0 - beer * beer) * 2.6, 0.0, 1.0));
      float silver = clamp(0.51 / pow(1.49 - dot(direction, sunDirection) * 1.4, 1.5), 0.0, 3.0);
      vec3 sunAtCloud = ${SOLAR_ILLUMINANCE.toFixed(1)} * atmosphereTransmittance(normalize(sunDirection + vec3(0.0, 0.012, 0.0)));
      vec3 moonAtCloud = moonLux * atmosphereTransmittance(normalize(moonDirection + vec3(0.0, 0.012, 0.0)));
      vec3 lit = (sunAtCloud + moonAtCloud) * shade * (1.0 + silver * mask * (1.0 - mask) * 2.0) + skyAmbient;
      vec3 cloud = lit * 0.8 / 3.14159;
      float alpha = (1.0 - exp(-depth * 6.0)) * mask;
      vec3 seen = cloud * viewTransmittance + radiance * (1.0 - viewTransmittance);
      radiance = mix(radiance, seen, alpha);
    }

    // The sun disc (0.265° radius); hidden when baking the environment to avoid fireflies.
    if (sunDisc > 0.5) {
      float disc = smoothstep(0.999989, 0.9999895, dot(direction, sunDirection));
      vec3 discRadiance = ${SOLAR_ILLUMINANCE.toFixed(1)} / 6.8e-5 * atmosphereTransmittance(sunDirection);
      radiance += min(discRadiance, vec3(4e8)) * disc;
    }

    // Below the horizon (seen by the environment bake): sunlit meadow and far hills, behind
    // the haze of the path already in radiance.
    if (above < 0.0) {
      float cosTheta = clamp(-above, 0.0, 1.0);
      float pathLength = OBSERVER_HEIGHT * 40.0 / max(cosTheta, 0.01);
      vec3 pathTransmittance = exp(-(RAYLEIGH_SCATTERING + MIE_EXTINCTION) * pathLength);
      radiance += groundColour * pathTransmittance;
    }

    gl_FragColor = vec4(min(radiance * preExposure, vec3(30000.0)), 1.0);
  }
`;

export type SkyOptions = { cloudCoverage?: number };
export type SkyAmbient = {
  /** Horizontal illuminance from the sky dome, sun- and moon-lit (lux, RGB). */
  skyIlluminance: Vec3;
  /** Radiance of the sunlit meadow below the horizon (cd/m²). */
  groundRadiance: Vec3;
};

export class SkyDome {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  readonly material: ShaderMaterial;
  constructor(options: SkyOptions = {}) {
    this.material = new ShaderMaterial({
      name: "meadow-sky",
      side: BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: true,
      uniforms: {
        sunDirection: { value: new Vector3(0, 1, 0) },
        moonDirection: { value: new Vector3(0, -1, 0) },
        preExposure: { value: 1 },
        sunDisc: { value: 1 },
        moonLux: { value: 0 },
        stars: { value: 0 },
        cloudCoverage: { value: options.cloudCoverage ?? 0.28 },
        time: { value: 0 },
        skyAmbient: { value: new Color(0, 0, 0) },
        groundColour: { value: new Color(0, 0, 0) },
        detail: { value: 1 },
      },
      vertexShader,
      fragmentShader,
    });
    this.mesh = new Mesh(new SphereGeometry(1, 48, 24), this.material);
    this.mesh.name = "sky";
    this.mesh.frustumCulled = false;
    // Drawn after all opaque geometry (and before the blended sea and glass) so the depth test
    // rejects every pixel the island or seabed already covers: the ray-marched atmosphere is
    // the most expensive shader in the scene and must only run where the sky is visible.
    this.mesh.renderOrder = 1000;
    this.mesh.scale.setScalar(20_000);
  }
  apply(sky: Celestial, time: number, ambient: SkyAmbient) {
    const u = this.material.uniforms as Record<string, { value: unknown }>;
    (u.sunDirection as { value: Vector3 }).value.set(...sky.sun.direction);
    (u.moonDirection as { value: Vector3 }).value.set(...sky.moon.direction);
    set(u.preExposure, sky.preExposure);
    set(u.moonLux, moonTopLux(sky.moonPhase));
    set(u.stars, sky.night);
    set(u.time, time);
    (u.skyAmbient as { value: Color }).value.setRGB(...ambient.skyIlluminance);
    // Physical cd/m²: the shader applies pre-exposure once, at output.
    (u.groundColour as { value: Color }).value.setRGB(...ambient.groundRadiance);
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
function set(uniform: { value: unknown } | undefined, value: number) {
  if (uniform) uniform.value = value;
}

/** CPU estimates used by clouds and the environment's lower hemisphere. */
export function skyAmbient(sky: Celestial): SkyAmbient {
  const moonTop = moonTopLux(sky.moonPhase);
  const fromSun = skyIlluminance(sky.sun.direction, SOLAR_ILLUMINANCE, 6);
  const fromMoon =
    moonTop > 1e-5 ? skyIlluminance(sky.moon.direction, moonTop, 6) : ([0, 0, 0] as Vec3);
  const skyE = [0, 1, 2].map((i) => (fromSun[i] ?? 0) + (fromMoon[i] ?? 0)) as Vec3;
  // A Lambertian meadow (albedo ~0.14, green) lit by sun and sky.
  const sunOnGround = Math.max(0, sky.sun.direction[1]) * sky.sunLux;
  const albedo: Vec3 = [0.1, 0.14, 0.06];
  const groundRadiance = skyE.map(
    (v, i) => ((v + sunOnGround * (sky.sunColour[i] ?? 1)) * (albedo[i] ?? 0.1)) / Math.PI,
  ) as Vec3;
  return { skyIlluminance: skyE, groundRadiance };
}

/** Horizon haze radiance (cd/m², not pre-exposed) looking along a horizontal direction. */
export function hazeRadiance(sky: Celestial, flatDirection: [number, number]): Vec3 {
  const dir: Vec3 = [flatDirection[0], 0.02, flatDirection[1]];
  const moonTop = moonTopLux(sky.moonPhase);
  const sun = scatter(dir, sky.sun.direction, SOLAR_ILLUMINANCE);
  const moon = moonTop > 1e-5 ? scatter(dir, sky.moon.direction, moonTop) : ([0, 0, 0] as Vec3);
  return [0, 1, 2].map((i) => (sun[i] ?? 0) + (moon[i] ?? 0) + 0.0002) as Vec3;
}

/**
 * Renders the sky alone into a small cube and prefilters it with PMREM, so image-based light
 * always matches the visible sky. Callers throttle rebakes while the hour is changing.
 */
export class EnvironmentBaker {
  private readonly scene = new Scene();
  private readonly target = new WebGLCubeRenderTarget(128, { type: HalfFloatType });
  private readonly camera = new CubeCamera(0.1, 100_000, this.target);
  private readonly pmrem: PMREMGenerator;
  /** One prefiltered target, reused: disposing only a render target's texture leaks the target. */
  private output: WebGLRenderTarget | null = null;
  private readonly bakeDome: SkyDome;
  constructor(private readonly renderer: WebGLRenderer) {
    this.pmrem = new PMREMGenerator(renderer);
    this.bakeDome = new SkyDome();
    this.scene.add(this.bakeDome.mesh);
  }
  bake(sky: Celestial, time: number, ambient: SkyAmbient): Texture {
    this.bakeDome.apply(sky, time, ambient);
    const u = this.bakeDome.material.uniforms as Record<string, { value: unknown }>;
    set(u.sunDisc, 0);
    set(u.detail, 0);
    set(u.stars, 0);
    this.camera.update(this.renderer, this.scene);
    this.output = this.pmrem.fromCubemap(this.target.texture, this.output);
    return this.output.texture;
  }
  dispose() {
    this.output?.dispose();
    this.target.dispose();
    this.pmrem.dispose();
    this.bakeDome.dispose();
  }
}
