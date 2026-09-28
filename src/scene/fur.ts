import * as THREE from "three";

// Shell fur for a skinned body. The same skinned mesh is drawn once as the undercoat and then N
// times as shells pushed out along the skinned normal; each shell keeps only the fragments that
// fall inside a strand. Strands are cells of a 3D lattice in the body's bind space, so a strand
// stays the same strand at every height and never swims as the bear moves. Strands taper, bend
// along the comb and under gravity, gather into clumps, and flatten, darken and turn glossy where
// the fur is wet. Lighting is the scene's physical model (MeshPhysicalMaterial), with the fur's
// own self-occlusion applied inside it.

export const FUR_COLOURS = {
  bodyRoot: new THREE.Color(0x4a2b17),
  bodyTip: new THREE.Color(0xa8703f),
  creamRoot: new THREE.Color(0xc49d72),
  creamTip: new THREE.Color(0xf4e2c2),
  darkRoot: new THREE.Color(0x2e1d12),
  darkTip: new THREE.Color(0x6e4a2e),
  pad: new THREE.Color(0x2f2622),
};

/** Shared by every fur material; the bear's wetness and the wind write here each frame. */
export const furUniforms = {
  uTime: { value: 0 },
  /** Bind-space height below which the fur is soaked (negative: dry). */
  uWetLine: { value: -1 },
  /** 0 … 1: how soaked the fur below the line is. */
  uSoak: { value: 0 },
  /** 0 … 1: patchy wetness anywhere (spray, splashes). */
  uSplash: { value: 0 },
  /** 0 … 1: fluffed up after a shake. */
  uFrizz: { value: 0 },
  /** World-space push at the tips (metres of bend per metre of fur). */
  uWind: { value: new THREE.Vector3() },
  uLength: { value: 0.04 },
  uDensity: { value: 320 },
  uClumpDensity: { value: 42 },
  uClump: { value: 0.45 },
  uBodyRoot: { value: FUR_COLOURS.bodyRoot },
  uBodyTip: { value: FUR_COLOURS.bodyTip },
  uCreamRoot: { value: FUR_COLOURS.creamRoot },
  uCreamTip: { value: FUR_COLOURS.creamTip },
  uDarkRoot: { value: FUR_COLOURS.darkRoot },
  uDarkTip: { value: FUR_COLOURS.darkTip },
  uPad: { value: FUR_COLOURS.pad },
};

const COMMON = /* glsl */ `
uniform float uH;
uniform float uTime;
uniform float uWetLine;
uniform float uSoak;
uniform float uSplash;
uniform float uFrizz;
uniform float uLength;
uniform float uDensity;
uniform float uClumpDensity;
uniform float uClump;
varying vec3 vRest;
varying vec4 vFur;
varying float vWet;
varying vec3 vStrand;
vec3 furHash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float furNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = furHash3(i).x;
  float n100 = furHash3(i + vec3(1.0, 0.0, 0.0)).x;
  float n010 = furHash3(i + vec3(0.0, 1.0, 0.0)).x;
  float n110 = furHash3(i + vec3(1.0, 1.0, 0.0)).x;
  float n001 = furHash3(i + vec3(0.0, 0.0, 1.0)).x;
  float n101 = furHash3(i + vec3(1.0, 0.0, 1.0)).x;
  float n011 = furHash3(i + vec3(0.0, 1.0, 1.0)).x;
  float n111 = furHash3(i + vec3(1.0, 1.0, 1.0)).x;
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}
float furWetness(vec3 rest, float band) {
  float edge = (furNoise(rest * 22.0) - 0.5) * 0.07;
  float soaked = uSoak * smoothstep(uWetLine + band, uWetLine - band, rest.y + edge);
  float spray = uSplash * smoothstep(0.45, 0.8, furNoise(rest * 11.0 + 7.3));
  return clamp(max(soaked, spray), 0.0, 1.0);
}
`;

const VERTEX_PARS = /* glsl */ `
attribute vec4 fur;
attribute vec3 comb;
uniform vec3 uWind;
${COMMON}
`;

const VERTEX_MAIN = /* glsl */ `
#include <skinning_vertex>
vRest = position;
vFur = fur;
// The fur's lie changes over a wide band, so the shells never shear at the water line.
vWet = furWetness(position, 0.12);
{
  #ifdef USE_SKINNING
    vec3 combObj = (skinMatrix * vec4(comb, 0.0)).xyz;
  #else
    vec3 combObj = comb;
  #endif
  mat3 toObject = inverse(mat3(modelMatrix));
  vec3 gravity = normalize(toObject * vec3(0.0, -1.0, 0.0));
  vec3 wind = toObject * uWind;
  float len = fur.x * 1.5 * uLength * mix(1.0, 0.62, vWet) * (1.0 + uFrizz * 0.35);
  // Fur leaves the skin at a shallow angle and lies down along the comb, sagging a little under
  // gravity; wet fur lies flatter and hangs, frizz lifts it back off the skin.
  vec3 lay = normalize(combObj + gravity * mix(0.3, 0.9, vWet)) + wind;
  float rise = mix(0.55, 0.28, vWet) * (1.0 + uFrizz * 0.6);
  float h = uH;
  vec3 n = normalize(objectNormal);
  transformed += (n * h * rise + lay * (h * 0.45 + h * h * 0.5)) * len;
  // The strand's direction here (the curve's tangent), for the hair highlight.
  vStrand = normalize(normalMatrix * (n * rise + lay * (0.45 + h)));
}
`;

const FRAGMENT_PARS = /* glsl */ `
uniform vec3 uBodyRoot;
uniform vec3 uBodyTip;
uniform vec3 uCreamRoot;
uniform vec3 uCreamTip;
uniform vec3 uDarkRoot;
uniform vec3 uDarkTip;
uniform vec3 uPad;
${COMMON}
`;

// Replaces <color_fragment>: decides strand coverage and colour for this shell.
const FRAGMENT_FUR = /* glsl */ `
float furOcc = 1.0;
vec3 furRand = vec3(0.5);
vec3 furSheen = vec3(0.0);
float wet = max(vWet * 0.6, furWetness(vRest, 0.035));
{
  float h = uH;
  vec3 rootC = mix(mix(uBodyRoot, uCreamRoot, vFur.y), uDarkRoot, vFur.z);
  vec3 tipC = mix(mix(uBodyTip, uCreamTip, vFur.y), uDarkTip, vFur.z);
  float t = 0.0;
  float jitter = 1.0;
  // Strand cells per pixel, taken before any discard (derivatives need uniform control flow).
  // Where a strand shrinks to about a pixel it fattens into a continuous coat, so distant fur
  // reads as a soft surface instead of sparkling.
  float far = smoothstep(0.35, 1.1, length(fwidth(vRest * uDensity)));
  if (h > 0.0) {
    if (vFur.x < 0.02) discard;
    // Clumps: strands lean toward their clump's centre as they rise (tighter when wet).
    vec3 cp = vRest * uClumpDensity;
    vec3 ci = floor(cp);
    vec3 centre = (ci + 0.3 + 0.4 * furHash3(ci + 17.0)) / uClumpDensity;
    float k = clamp((mix(uClump, 0.95, wet) - uFrizz * 0.15) * h, 0.0, 0.94);
    vec3 q = centre + (vRest - centre) / (1.0 - k);
    // Guard hairs: one per lattice cell, jittered away from the cell walls so they never clip.
    vec3 sp = q * uDensity;
    vec3 si = floor(sp);
    vec3 r = furHash3(si);
    float strand = mix(0.5, 1.0, r.x) * mix(1.0, 0.75, wet);
    t = h / strand;
    float d = length(fract(sp) - (0.25 + 0.5 * r));
    float radius = mix(mix(0.3, 0.1, t), 0.47 * (1.0 - 0.45 * t), far);
    // Soft strand edges up close (alpha-to-coverage smooths them); hard ones once a strand is
    // about a pixel wide, where soft edges would all dither with the same sample pattern.
    float edge = mix(0.04, 0.002, far);
    float cover = (1.0 - smoothstep(radius - edge, radius + edge, d)) * step(t, 1.0);
    // Undercoat: twice as dense, short and fine, filling the roots.
    vec3 up = q * uDensity * 2.0 + 11.0;
    vec3 ui = floor(up);
    vec3 ur = furHash3(ui);
    float tu = h / (0.42 * mix(0.6, 1.0, ur.x));
    float du = length(fract(up) - (0.25 + 0.5 * ur));
    float under = (1.0 - smoothstep(0.22 - edge, 0.22 + edge, du + tu * 0.1)) * step(tu, 1.0);
    if (under > cover) {
      t = tu * 0.55;
      r = ur;
    }
    cover = max(cover, under);
    if (cover < 0.02) discard;
    diffuseColor.a = cover;
    jitter = mix(0.84 + 0.32 * r.y, 1.0, far * 0.7);
    furRand = r;
    tipC *= mix(vec3(1.0), vec3(1.06, 0.98, 0.9), r.z);
  } else {
    diffuseColor.a = 1.0;
  }
  // Far away the gradient flattens and the undercoat lifts, so strand and gap stop flickering.
  float grade = h > 0.0 ? mix(smoothstep(0.0, 1.0, t), 0.45 + 0.55 * t, far) : 0.55 * far;
  vec3 col = mix(rootC, tipC, grade) * jitter;
  col = mix(col, uPad, vFur.w * (1.0 - h));
  // Water fills the gaps between fibres: darker and richer.
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, max(vec3(0.0), mix(vec3(luma), col, 1.5)) * 0.15, wet);
  diffuseColor.rgb = col;
  // The velvet rim comes from the strand's own colour, not a cream lobe that ignores it.
  furSheen = mix(tipC, vec3(1.0), 0.15) * jitter;
  // Deep fur is shadowed by the fur above it.
  furOcc = h > 0.0 ? mix(mix(0.7, 0.88, far), 1.0, pow(clamp(t, 0.0, 1.0), 0.75))
    : mix(0.72, 0.9, far) + 0.08 * vFur.w;
  // Wet clumps shade one another.
  furOcc *= mix(1.0, 0.62, wet);
}
`;

const FRAGMENT_ROUGHNESS = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = mix(0.8, 0.55, vFur.w);
`;

const FRAGMENT_MATERIAL = /* glsl */ `
#include <lights_physical_fragment>
#ifdef USE_SHEEN
  material.sheenColor = furSheen * 0.45 * (1.0 - wet);
#endif
`;

// Self-occlusion, then a Kajiya-Kay highlight from the sun along each strand: soft and faint on
// dry fur, tight and bright where water coats the fibres and pulls them into clumps.
const FRAGMENT_OCCLUSION = /* glsl */ `
#include <aomap_fragment>
reflectedLight.indirectDiffuse *= furOcc;
reflectedLight.indirectSpecular *= furOcc;
reflectedLight.directDiffuse *= mix(1.0, furOcc, 0.4);
reflectedLight.directSpecular *= furOcc;
#if NUM_DIR_LIGHTS > 0
{
  // Each strand leans a little its own way, so the highlight breaks into glints along the fur.
  vec3 T = normalize(vStrand + (furRand - 0.5) * mix(0.5, 0.8, wet));
  vec3 H = normalize(directLight.direction + geometryViewDir);
  float th = dot(T, H);
  float sinTH = sqrt(max(0.0, 1.0 - th * th));
  float shine = mix(30.0, 420.0, wet);
  // Wet glints ride the clumped tips; dry sheen runs the whole strand.
  float tips = mix(1.0, smoothstep(0.45, 0.95, uH), wet);
  float strength = mix(0.028, 0.07, wet) * (0.4 + 1.2 * furRand.z) * tips;
  float wrap = saturate(dot(normal, directLight.direction) * 0.6 + 0.4);
  vec3 tint = mix(diffuseColor.rgb * 2.0, vec3(0.7), wet);
  reflectedLight.directSpecular += directLight.color * tint * pow(sinTH, shine) * strength * wrap * furOcc;
}
#endif
`;

function furCompile(this: THREE.Material, shader: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, furUniforms, { uH: this.userData.uH });
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
    .replace("#include <skinning_vertex>", VERTEX_MAIN);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${FRAGMENT_PARS}`)
    .replace("#include <color_fragment>", FRAGMENT_FUR)
    .replace("#include <roughnessmap_fragment>", FRAGMENT_ROUGHNESS)
    .replace("#include <lights_physical_fragment>", FRAGMENT_MATERIAL)
    .replace("#include <aomap_fragment>", FRAGMENT_OCCLUSION);
}

/** One layer of fur: h = 0 is the undercoat skin, h in (0, 1] a shell. */
export function furMaterial(h: number, coverage: boolean) {
  const m = new THREE.MeshPhysicalMaterial({
    roughness: 0.78,
    sheen: 0.55,
    sheenRoughness: 0.45,
    sheenColor: new THREE.Color(0xffe2c0),
    alphaTest: h > 0 ? 0.5 : 0,
    alphaToCoverage: h > 0 && coverage,
  });
  m.userData.uH = { value: h };
  m.onBeforeCompile = furCompile;
  return m;
}

export interface FurLayers {
  base: THREE.SkinnedMesh;
  shells: THREE.SkinnedMesh[];
  /** Shows every n-th shell (1 = all); the adaptive quality step thins the fur this way. */
  thin(n: number): void;
}

/** Undercoat plus `count` shells on the given geometries, all bound to one skeleton. */
export function buildFur(
  baseGeometry: THREE.BufferGeometry,
  shellGeometry: THREE.BufferGeometry,
  skeleton: THREE.Skeleton,
  count: number,
  coverage: boolean,
): FurLayers {
  const bind = new THREE.Matrix4();
  const make = (geometry: THREE.BufferGeometry, h: number, order: number) => {
    const mesh = new THREE.SkinnedMesh(geometry, furMaterial(h, coverage));
    mesh.bind(skeleton, bind);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.receiveShadow = true;
    return mesh;
  };
  const base = make(baseGeometry, 0, 0);
  const shells = Array.from({ length: count }, (_, i) =>
    make(shellGeometry, (i + 1) / count, i + 1),
  );
  return {
    base,
    shells,
    thin(n) {
      shells.forEach((s, i) => {
        s.visible = (i + 1) % n === 0;
      });
    },
  };
}
