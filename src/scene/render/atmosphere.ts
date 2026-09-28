// Adapted from ODD TIDE (William King's portfolio collection, src/world/render/atmosphere.ts),
// reused with permission. Unchanged physics; see that project for derivation notes.

// Single-scattering atmosphere over a spherical Earth: Rayleigh, Mie and ozone, in physical
// units. Scattering coefficients are per metre, phase functions per steradian and incident
// light in lux, so radiance comes out in cd/m² with no calibration factor. The same model runs
// in GLSL (sky dome, environment bake) and here on the CPU (sun colour, haze, tests), so the
// sky, the sunlight and the aerial perspective can never disagree.
// Constants follow Bruneton & Neyret (2008) and Hillaire (2020); a maritime aerosol load
// (1.5× the clean-air Mie value) gives the island its soft sea haze. Checked numerically against
// clear-sky references: ~103 klx direct and ~11 klx diffuse at 38° sun, ~10 lx at -6°.

export type Vec3 = [number, number, number];

export const EARTH_RADIUS = 6_360_000;
export const ATMOSPHERE_RADIUS = 6_460_000;
export const OBSERVER_HEIGHT = 20;
export const RAYLEIGH_SCATTERING: Vec3 = [5.802e-6, 13.558e-6, 33.1e-6];
export const RAYLEIGH_HEIGHT = 8_000;
export const MIE_SCATTERING = 3.996e-6 * 1.5;
export const MIE_EXTINCTION = 4.44e-6 * 1.5;
export const MIE_HEIGHT = 1_200;
export const MIE_G = 0.8;
// Red uses a broadband Chappuis average (the band peaks near 600 nm), which keeps blue hour blue.
export const OZONE_ABSORPTION: Vec3 = [1.9e-6, 1.881e-6, 0.085e-6];
export const OZONE_CENTRE = 25_000;
export const OZONE_HALF_WIDTH = 15_000;
/** Solar illuminance outside the atmosphere, lux. */
export const SOLAR_ILLUMINANCE = 128_000;
/** Crude multiple-scattering allowance (single scattering underestimates twilight). */
export const MULTIPLE_SCATTERING = 2.4;
const VIEW_STEPS = 16;
const LIGHT_STEPS = 6;

export const ATMOSPHERE_GLSL = /* glsl */ `
  const float EARTH_RADIUS = ${EARTH_RADIUS.toFixed(1)};
  const float ATMOSPHERE_RADIUS = ${ATMOSPHERE_RADIUS.toFixed(1)};
  const float OBSERVER_HEIGHT = ${OBSERVER_HEIGHT.toFixed(1)};
  const vec3 RAYLEIGH_SCATTERING = vec3(${RAYLEIGH_SCATTERING.map((v) => v.toExponential(4)).join(", ")});
  const float RAYLEIGH_HEIGHT = ${RAYLEIGH_HEIGHT.toFixed(1)};
  const float MIE_SCATTERING = ${MIE_SCATTERING.toExponential(4)};
  const float MIE_EXTINCTION = ${MIE_EXTINCTION.toExponential(4)};
  const float MIE_HEIGHT = ${MIE_HEIGHT.toFixed(1)};
  const float MIE_G = ${MIE_G.toFixed(3)};
  const vec3 OZONE_ABSORPTION = vec3(${OZONE_ABSORPTION.map((v) => v.toExponential(4)).join(", ")});
  const float OZONE_CENTRE = ${OZONE_CENTRE.toFixed(1)};
  const float OZONE_HALF_WIDTH = ${OZONE_HALF_WIDTH.toFixed(1)};
  const float MULTIPLE_SCATTERING = ${MULTIPLE_SCATTERING.toFixed(3)};

  vec2 atmosphereSphere(vec3 origin, vec3 direction, float radius) {
    float b = dot(origin, direction);
    float c = dot(origin, origin) - radius * radius;
    float d = b * b - c;
    if (d < 0.0) return vec2(-1.0);
    d = sqrt(d);
    return vec2(-b - d, -b + d);
  }
  vec3 atmosphereDensity(float height) {
    float ozone = max(0.0, 1.0 - abs(height - OZONE_CENTRE) / OZONE_HALF_WIDTH);
    return vec3(exp(-height / RAYLEIGH_HEIGHT), exp(-height / MIE_HEIGHT), ozone);
  }
  vec3 atmosphereExtinction(vec3 depth) {
    return RAYLEIGH_SCATTERING * depth.x + MIE_EXTINCTION * depth.y + OZONE_ABSORPTION * depth.z;
  }
  // Radiance (cd/m²) scattered toward the observer along 'direction' from a distant source of
  // illuminance 'lux' in direction 'light'. 'maxDistance' clips the path (aerial perspective).
  vec3 atmosphereScatter(vec3 direction, vec3 light, float lux, float maxDistance) {
    vec3 origin = vec3(0.0, EARTH_RADIUS + OBSERVER_HEIGHT, 0.0);
    float end = atmosphereSphere(origin, direction, ATMOSPHERE_RADIUS).y;
    vec2 ground = atmosphereSphere(origin, direction, EARTH_RADIUS);
    if (ground.x > 0.0) end = min(end, ground.x);
    end = min(end, maxDistance);
    vec3 depth = vec3(0.0);
    vec3 rayleigh = vec3(0.0);
    vec3 mie = vec3(0.0);
    // Quadratic spacing: dense near the observer, where blue light saturates within kilometres.
    for (int i = 0; i < ${VIEW_STEPS}; i++) {
      float u0 = float(i) / ${VIEW_STEPS.toFixed(1)};
      float u1 = float(i + 1) / ${VIEW_STEPS.toFixed(1)};
      float step = end * (u1 * u1 - u0 * u0);
      vec3 p = origin + direction * end * (u0 * u0 + u1 * u1) * 0.5;
      vec3 density = atmosphereDensity(length(p) - EARTH_RADIUS) * step;
      depth += density;
      if (atmosphereSphere(p, light, EARTH_RADIUS).x > 0.0) continue;
      float lightEnd = atmosphereSphere(p, light, ATMOSPHERE_RADIUS).y;
      vec3 lightDepth = vec3(0.0);
      for (int j = 0; j < ${LIGHT_STEPS}; j++) {
        float v0 = float(j) / ${LIGHT_STEPS.toFixed(1)};
        float v1 = float(j + 1) / ${LIGHT_STEPS.toFixed(1)};
        vec3 q = p + light * lightEnd * (v0 * v0 + v1 * v1) * 0.5;
        lightDepth += atmosphereDensity(length(q) - EARTH_RADIUS) * lightEnd * (v1 * v1 - v0 * v0);
      }
      vec3 attenuation = exp(-atmosphereExtinction(depth + lightDepth));
      rayleigh += density.x * attenuation;
      mie += density.y * attenuation;
    }
    float mu = dot(direction, light);
    float rayleighPhase = 0.0596831 * (1.0 + mu * mu);
    float g2 = MIE_G * MIE_G;
    float miePhase = 0.1193662 * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * MIE_G * mu, 1.5));
    vec3 single = rayleigh * RAYLEIGH_SCATTERING * rayleighPhase + mie * MIE_SCATTERING * miePhase;
    vec3 multiple = (rayleigh * RAYLEIGH_SCATTERING + mie * MIE_SCATTERING) * 0.0795775 * (MULTIPLE_SCATTERING - 1.0);
    return (single + multiple) * lux;
  }
  // Transmittance along a ray from the observer (for the sun or moon disc).
  vec3 atmosphereTransmittance(vec3 direction) {
    vec3 origin = vec3(0.0, EARTH_RADIUS + OBSERVER_HEIGHT, 0.0);
    if (atmosphereSphere(origin, direction, EARTH_RADIUS).x > 0.0) return vec3(0.0);
    float end = atmosphereSphere(origin, direction, ATMOSPHERE_RADIUS).y;
    vec3 depth = vec3(0.0);
    for (int i = 0; i < ${VIEW_STEPS}; i++) {
      float u0 = float(i) / ${VIEW_STEPS.toFixed(1)};
      float u1 = float(i + 1) / ${VIEW_STEPS.toFixed(1)};
      vec3 p = origin + direction * end * (u0 * u0 + u1 * u1) * 0.5;
      depth += atmosphereDensity(length(p) - EARTH_RADIUS) * end * (u1 * u1 - u0 * u0);
    }
    return exp(-atmosphereExtinction(depth));
  }
`;

// ---------------------------------------------------------------------------------------------
// CPU mirror of the GLSL above.

function sphere(origin: Vec3, direction: Vec3, radius: number): [number, number] {
  const b = dot(origin, direction);
  const c = dot(origin, origin) - radius * radius;
  const d = b * b - c;
  if (d < 0) return [-1, -1];
  const s = Math.sqrt(d);
  return [-b - s, -b + s];
}
function density(height: number): Vec3 {
  const ozone = Math.max(0, 1 - Math.abs(height - OZONE_CENTRE) / OZONE_HALF_WIDTH);
  return [Math.exp(-height / RAYLEIGH_HEIGHT), Math.exp(-height / MIE_HEIGHT), ozone];
}
function extinction(depth: Vec3): Vec3 {
  return [0, 1, 2].map(
    (i) =>
      (RAYLEIGH_SCATTERING[i] ?? 0) * depth[0] +
      MIE_EXTINCTION * depth[1] +
      (OZONE_ABSORPTION[i] ?? 0) * depth[2],
  ) as Vec3;
}

/** Transmittance from the observer to space along a direction (0 below the horizon). */
export function transmittance(direction: Vec3): Vec3 {
  const origin: Vec3 = [0, EARTH_RADIUS + OBSERVER_HEIGHT, 0];
  const dir = normalise(direction);
  if (sphere(origin, dir, EARTH_RADIUS)[0] > 0) return [0, 0, 0];
  const end = sphere(origin, dir, ATMOSPHERE_RADIUS)[1];
  const depth: Vec3 = [0, 0, 0];
  for (let i = 0; i < VIEW_STEPS; i++) {
    const [t, step] = quadratic(i, VIEW_STEPS, end);
    const d = density(length(add(origin, scale(dir, t))) - EARTH_RADIUS);
    for (let k = 0; k < 3; k++) depth[k] = (depth[k] ?? 0) + (d[k] ?? 0) * step;
  }
  return extinction(depth).map((v) => Math.exp(-v)) as Vec3;
}

/** Radiance (cd/m²) scattered toward the observer; mirrors atmosphereScatter in GLSL. */
export function scatter(direction: Vec3, light: Vec3, lux: number, maxDistance = Infinity): Vec3 {
  const origin: Vec3 = [0, EARTH_RADIUS + OBSERVER_HEIGHT, 0];
  const dir = normalise(direction);
  const src = normalise(light);
  let end = sphere(origin, dir, ATMOSPHERE_RADIUS)[1];
  const ground = sphere(origin, dir, EARTH_RADIUS);
  if (ground[0] > 0) end = Math.min(end, ground[0]);
  end = Math.min(end, maxDistance);
  const depth: Vec3 = [0, 0, 0];
  const rayleigh: Vec3 = [0, 0, 0];
  const mie: Vec3 = [0, 0, 0];
  for (let i = 0; i < VIEW_STEPS; i++) {
    const [t, step] = quadratic(i, VIEW_STEPS, end);
    const p = add(origin, scale(dir, t));
    const d = scale(density(length(p) - EARTH_RADIUS), step);
    for (let k = 0; k < 3; k++) depth[k] = (depth[k] ?? 0) + (d[k] ?? 0);
    if (sphere(p, src, EARTH_RADIUS)[0] > 0) continue;
    const lightEnd = sphere(p, src, ATMOSPHERE_RADIUS)[1];
    const lightDepth: Vec3 = [0, 0, 0];
    for (let j = 0; j < LIGHT_STEPS; j++) {
      const [t, lightStep] = quadratic(j, LIGHT_STEPS, lightEnd);
      const dq = density(length(add(p, scale(src, t))) - EARTH_RADIUS);
      for (let k = 0; k < 3; k++) lightDepth[k] = (lightDepth[k] ?? 0) + (dq[k] ?? 0) * lightStep;
    }
    const attenuation = extinction(add(depth, lightDepth)).map((v) => Math.exp(-v));
    for (let k = 0; k < 3; k++) {
      rayleigh[k] = (rayleigh[k] ?? 0) + d[0] * (attenuation[k] ?? 0);
      mie[k] = (mie[k] ?? 0) + d[1] * (attenuation[k] ?? 0);
    }
  }
  const mu = dot(dir, src);
  const rayleighPhase = 0.0596831 * (1 + mu * mu);
  const g2 = MIE_G * MIE_G;
  const miePhase =
    (0.1193662 * (1 - g2) * (1 + mu * mu)) / ((2 + g2) * (1 + g2 - 2 * MIE_G * mu) ** 1.5);
  return [0, 1, 2].map((k) => {
    const r = (rayleigh[k] ?? 0) * (RAYLEIGH_SCATTERING[k] ?? 0);
    const m = (mie[k] ?? 0) * MIE_SCATTERING;
    return (
      (r * rayleighPhase + m * miePhase + (r + m) * 0.0795775 * (MULTIPLE_SCATTERING - 1)) * lux
    );
  }) as Vec3;
}

/** Horizontal illuminance from the sky dome (not the direct disc), lux; for tests/calibration. */
export function skyIlluminance(light: Vec3, lux: number, samples = 24): Vec3 {
  const total: Vec3 = [0, 0, 0];
  for (let a = 0; a < samples * 2; a++)
    for (let b = 0; b < samples; b++) {
      const phi = ((a + 0.5) / (samples * 2)) * Math.PI * 2;
      const theta = ((b + 0.5) / samples) * (Math.PI / 2);
      const dir: Vec3 = [
        Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi),
      ];
      const radiance = scatter(dir, light, lux);
      const solidAngle =
        Math.sin(theta) * (Math.PI / 2 / samples) * ((Math.PI * 2) / (samples * 2));
      for (let k = 0; k < 3; k++)
        total[k] = (total[k] ?? 0) + (radiance[k] ?? 0) * Math.cos(theta) * solidAngle;
    }
  return total;
}

/** Midpoint distance and length of step i when n steps are spaced quadratically over 'end'. */
function quadratic(i: number, n: number, end: number): [number, number] {
  const u0 = i / n;
  const u1 = (i + 1) / n;
  return [(end * (u0 * u0 + u1 * u1)) / 2, end * (u1 * u1 - u0 * u0)];
}

export const luminance = (c: Vec3) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function length(a: Vec3) {
  return Math.hypot(a[0], a[1], a[2]);
}
function normalise(a: Vec3): Vec3 {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
