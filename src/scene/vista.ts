import * as THREE from "three";
import { fbm, forestDensity, LAKE, landHeight, landHeightFast, PLATEAU } from "./land";
import { buildTreeVariant, type TreeVariant } from "./trees";
import type { VistaAssets } from "./vista-assets";

// Everything past the trail's own ground, out to the horizon:
// - the far land: the baked, eroded mountains and valley (tools/bake), wearing the light that
//   was path-traced onto them offline — sun, soft terrain and canopy shadows, cloud shadows,
//   sky light and bounce — or, before the bake loads, the analytic design;
// - tens of thousands of firs as camera-facing impostors of the game's own fir, where the bake
//   grew forest, each tinted by the light its crown receives;
// - the lake on the valley floor, reflecting the sky, with a sun glint;
// - birds wheeling over the valley, and raptors circling on the thermals.
// Aerial perspective comes from the scene's own haze (the fog), so it all recedes into blue.

/** The near terrain square (terrain.ts) this ring must not show through. */
export const NEAR = { x: -73, z: 27, half: 125 };

function heightAndSlope(x: number, z: number) {
  const h = landHeight(x, z);
  const e = 3;
  const dx = (landHeight(x + e, z) - landHeight(x - e, z)) / (2 * e);
  const dz = (landHeight(x, z + e) - landHeight(x, z - e)) / (2 * e);
  return { h, slope: Math.atan(Math.hypot(dx, dz)) };
}

const rgb = (hex: number) => new THREE.Color(hex);
const MEADOW = rgb(0x5f7a34);
const MEADOW_DRY = rgb(0x8c8a4a);
const FOREST = rgb(0x1f3522);
const ROCK = rgb(0x6f6960);
const SCREE = rgb(0x8d877b);
const SNOW = rgb(0xf2f5f7);

/** The far land: rings from just inside the near square out to the horizon. */
function farLand(detail: number) {
  const segs = Math.round(420 * detail + 120);
  const radii: number[] = [];
  for (let r = NEAR.half - 7; r < 7000; r *= 1 + 0.03 / detail) radii.push(r);
  const count = radii.length * segs;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let k = 0; k < radii.length; k++) {
    const r = radii[k] as number;
    for (let q = 0; q < segs; q++) {
      const a = (q / segs) * Math.PI * 2;
      const x = NEAR.x + Math.cos(a) * r;
      const z = NEAR.z + Math.sin(a) * r;
      const { h, slope } = heightAndSlope(x, z);
      // Inside the near square the ring hides just under the finer ground.
      const inside = Math.abs(x - NEAR.x) < NEAR.half - 1 && Math.abs(z - NEAR.z) < NEAR.half - 1;
      pos.set([x, h - (inside ? 1.2 : 0), z], (k * segs + q) * 3);
      const n = fbm(x / 90, z / 90, 3);
      const forest = forestDensity(x, z, h, slope);
      c.copy(MEADOW).lerp(MEADOW_DRY, Math.max(0, n * 0.9 + 0.2));
      c.lerp(FOREST, Math.min(1, forest * 1.3));
      const rock = Math.min(1, Math.max(0, (slope - 0.55) / 0.35) + Math.max(0, (h - 420) / 140));
      c.lerp(slope > 0.9 ? ROCK : SCREE, rock);
      const snow = Math.min(
        1,
        Math.max(0, (h - 560 - n * 110) / 80) * Math.max(0, 1 - (slope - 0.8) / 0.35),
      );
      c.lerp(SNOW, snow);
      if (h < LAKE.level + 1.2) c.lerp(rgb(0x5a5a48), 0.6);
      col.set([c.r, c.g, c.b], (k * segs + q) * 3);
    }
  }
  const idx: number[] = [];
  for (let k = 0; k < radii.length - 1; k++)
    for (let q = 0; q < segs; q++) {
      const a = k * segs + q;
      const b = k * segs + ((q + 1) % segs);
      idx.push(a, b, a + segs, b, b + segs, a + segs);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** Three independent octaves of tiling value noise (RGB), for close-up surface detail. */
function detailNoise() {
  const n = 256;
  const data = new Uint8Array(n * n * 4);
  const rnd = (i: number, j: number, c: number, p: number) => {
    let h = (((i % p) + p) % p) * 374761393 + (((j % p) + p) % p) * 668265263 + c * 1442695041;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++)
      for (let c = 0; c < 3; c++) {
        let v = 0;
        let amp = 0.5;
        for (const cells of [8, 16, 32, 64]) {
          const x = (i / n) * cells;
          const y = (j / n) * cells;
          const xi = Math.floor(x);
          const yi = Math.floor(y);
          const fx = x - xi;
          const fy = y - yi;
          const u = fx * fx * (3 - 2 * fx);
          const w = fy * fy * (3 - 2 * fy);
          const a = rnd(xi, yi, c + cells, cells);
          const b = rnd(xi + 1, yi, c + cells, cells);
          const cc = rnd(xi, yi + 1, c + cells, cells);
          const d = rnd(xi + 1, yi + 1, c + cells, cells);
          v += amp * (a + (b - a) * u + (cc - a) * w + (a - b - cc + d) * u * w);
          amp *= 0.5;
        }
        data[(j * n + i) * 4 + c] = Math.round((v / 0.9375) * 255);
      }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** The baked far land: a polar mesh on the eroded heights, lit by the baked light. */
function bakedLand(a: VistaAssets, detail: number) {
  // Rings as far apart as the spokes: silhouettes stay crisp on the far ranges.
  const segs = Math.round(1280 * detail);
  const growth = 1 + ((Math.PI * 2) / segs) * 0.9;
  const radii: number[] = [];
  for (let r = NEAR.half - 7; r < FAR; r *= growth) radii.push(r);
  radii.push(FAR);
  const count = radii.length * segs;
  const pos = new Float32Array(count * 3);
  for (let k = 0; k < radii.length; k++) {
    const r = radii[k] as number;
    for (let q = 0; q < segs; q++) {
      const ang = (q / segs) * Math.PI * 2;
      const x = NEAR.x + Math.cos(ang) * r;
      const z = NEAR.z + Math.sin(ang) * r;
      const inside = Math.abs(x - NEAR.x) < NEAR.half - 1 && Math.abs(z - NEAR.z) < NEAR.half - 1;
      const o = (k * segs + q) * 3;
      pos[o] = x;
      pos[o + 1] = landHeightFast(x, z) - (inside ? 1.2 : 0);
      pos[o + 2] = z;
    }
  }
  const idx = new Uint32Array((radii.length - 1) * segs * 6);
  let n = 0;
  for (let k = 0; k < radii.length - 1; k++)
    for (let q = 0; q < segs; q++) {
      const i0 = k * segs + q;
      const i1 = k * segs + ((q + 1) % segs);
      idx[n++] = i0;
      idx[n++] = i1;
      idx[n++] = i0 + segs;
      idx[n++] = i1;
      idx[n++] = i1 + segs;
      idx[n++] = i0 + segs;
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const gi = a.info.grids.inner;
  const go = a.info.grids.outer;
  const mat = new THREE.ShaderMaterial({
    name: "baked-land",
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        innerLight: { value: null },
        outerLight: { value: null },
        innerRect: { value: new THREE.Vector3(gi.x0, gi.z0, gi.size) },
        outerRect: { value: new THREE.Vector3(go.x0, go.z0, go.size) },
        lightScale: { value: a.info.lightScale },
        hush: { value: 1 },
        centre: { value: new THREE.Vector2(NEAR.x, NEAR.z) },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D innerLight;
      uniform sampler2D outerLight;
      uniform sampler2D innerMat;
      uniform sampler2D detailNoise;
      uniform vec3 innerRect;
      uniform vec3 outerRect;
      uniform float lightScale;
      uniform float hush;
      uniform vec2 centre;
      varying vec3 vWorld;
      void main() {
        vec2 uo = (vWorld.xz - outerRect.xy) / outerRect.z;
        vec3 col = texture2D(outerLight, vec2(uo.x, 1.0 - uo.y)).rgb;
        vec2 ui = (vWorld.xz - innerRect.xy) / innerRect.z;
        float edge = min(min(ui.x, ui.y), min(1.0 - ui.x, 1.0 - ui.y)) * innerRect.z;
        if (edge > 0.0) {
          vec3 fine = texture2D(innerLight, vec2(ui.x, 1.0 - ui.y)).rgb;
          col = mix(col, fine, smoothstep(0.0, 150.0, edge));
          // Close up, the baked light (2 m texels) gains surface detail by material: strata and
          // grit on rock, crowns and gaps in forest, tussocks in grass. Fades out by 900 m.
          float near = 1.0 - smoothstep(220.0, 900.0, distance(vWorld, cameraPosition));
          if (near > 0.0) {
            vec4 m = texture2D(innerMat, vec2(ui.x, 1.0 - ui.y));
            float n1 = texture2D(detailNoise, vWorld.xz / 3.1).r - 0.5;
            float n2 = texture2D(detailNoise, vWorld.xz / 11.3 + 0.37).g - 0.5;
            float n3 = texture2D(detailNoise, vec2(vWorld.x / 7.0, vWorld.y / 1.6) + 0.71).b - 0.5;
            float grass = max(0.0, 1.0 - m.r - m.g - m.b);
            float d = m.r * (n1 * 0.45 + n3 * 0.55) + m.g * (n1 * 0.9 + n2 * 0.4) + grass * (n1 * 0.22 + n2 * 0.18) + m.b * n1 * 0.12;
            col *= 1.0 + d * near;
          }
        }
        gl_FragColor = vec4(col * lightScale * hush, 1.0);
        #include <fog_fragment>
        // The last kilometres melt into the haze, so the edge of the world never shows.
        #ifdef USE_FOG
          float far = smoothstep(${(FAR - 1700).toFixed(1)}, ${FAR.toFixed(1)}, length(vWorld.xz - centre));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, far);
        #endif
      }`,
  });
  mat.uniforms.innerLight = { value: a.innerLight };
  mat.uniforms.outerLight = { value: a.outerLight };
  mat.uniforms.innerMat = { value: a.innerMat };
  mat.uniforms.detailNoise = { value: detailNoise() };
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.name = "baked-land";
  return mesh;
}

/** Firs where the bake grew forest, standing on the baked land, lit as the bake lit them. */
function bakedForest(
  renderer: THREE.WebGLRenderer,
  sun: THREE.Vector3,
  mats: { trunk: THREE.Material; foliage: THREE.Material },
  a: VistaAssets,
  detail: number,
) {
  const bake = bakeFir(renderer, buildTreeVariant(8.5, 16, 11), mats, sun);
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0, 0.5, 0);
  const mat = impostorMaterial(bake.texture);
  const f = a.forest;
  const max = Math.round(f.count * Math.min(1, detail * 1.4));
  const mesh = new THREE.InstancedMesh(quad, mat, max);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const colour = new THREE.Color();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < f.count && n < max; i++) {
    const x = f.x[i] as number;
    const z = f.z[i] as number;
    if (Math.abs(x - NEAR.x) < NEAR.half && Math.abs(z - NEAR.z) < NEAR.half) continue;
    const h = (f.h[i] as number) * 1.05;
    m4.compose(v.set(x, landHeightFast(x, z) - 0.6, z), q, sc.set(h * bake.aspect * 1.1, h, 1));
    mesh.setMatrixAt(n, m4);
    mesh.setColorAt(
      n,
      colour.setRGB(
        (f.tint[i * 3] as number) * 0.42,
        (f.tint[i * 3 + 1] as number) * 0.42,
        (f.tint[i * 3 + 2] as number) * 0.42,
      ),
    );
    n++;
  }
  mesh.count = n;
  mesh.frustumCulled = false;
  return mesh;
}

/** Render the fir once, side-on, into an RGBA texture lit like the scene. */
function bakeFir(
  renderer: THREE.WebGLRenderer,
  tree: TreeVariant,
  mats: { trunk: THREE.Material; foliage: THREE.Material },
  sun: THREE.Vector3,
) {
  const scene = new THREE.Scene();
  const h = 8.5;
  scene.add(new THREE.Mesh(tree.trunk, mats.trunk), new THREE.Mesh(tree.foliage, mats.foliage));
  const key = new THREE.DirectionalLight(0xfff1dc, 3.2);
  key.position.copy(sun).multiplyScalar(20);
  scene.add(key, new THREE.HemisphereLight(0xbcd3ea, 0x3d4a2a, 1.4));
  const cam = new THREE.OrthographicCamera(-h * 0.42, h * 0.42, h * 1.02, -0.2, 0.1, 100);
  cam.position.set(0, h * 0.4, 30);
  cam.lookAt(0, h * 0.4, 0);
  const target = new THREE.WebGLRenderTarget(128, 256, { colorSpace: THREE.SRGBColorSpace });
  const prev = renderer.getRenderTarget();
  const clear = renderer.getClearAlpha();
  const tm = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  renderer.setClearColor(0x000000, clear);
  renderer.toneMapping = tm;
  target.texture.generateMipmaps = true;
  return { texture: target.texture, height: h, aspect: 0.84 / 1.22 };
}

/** Camera-facing cards that turn about their own trunk. */
function impostorMaterial(map: THREE.Texture, color = 0xffffff) {
  const mat = new THREE.MeshBasicMaterial({ map, alphaTest: 0.45, color });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      `// Face the camera, turning only about the vertical.
       vec4 base = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
       float sx = length(instanceMatrix[0].xyz);
       float sy = length(instanceMatrix[1].xyz);
       vec3 toCam = cameraPosition - base.xyz;
       vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
       vec3 world = base.xyz + right * position.x * sx + vec3(0.0, position.y * sy, 0.0);
       vec4 mvPosition = viewMatrix * vec4(world, 1.0);
       gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  mat.fog = true;
  return mat;
}

/** Distant firs from the analytic design (before a bake exists). */
function forests(
  renderer: THREE.WebGLRenderer,
  sun: THREE.Vector3,
  mats: { trunk: THREE.Material; foliage: THREE.Material },
  detail: number,
) {
  const bake = bakeFir(renderer, buildTreeVariant(8.5, 16, 11), mats, sun);
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0, 0.5, 0);
  const mat = impostorMaterial(bake.texture, 0xa9b2a4);
  const max = Math.round(52000 * detail);
  const mesh = new THREE.InstancedMesh(quad, mat, max);
  const m4 = new THREE.Matrix4();
  const colour = new THREE.Color();
  let n = 0;
  let seed = 4051;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let tries = 0; tries < max * 9 && n < max; tries++) {
    // Denser samples nearer the plateau, where each tree covers more of the screen.
    const r = PLATEAU.r * 0.7 + 3000 * rand() ** 2.2;
    const a = rand() * Math.PI * 2;
    const x = PLATEAU.x + Math.cos(a) * r;
    const z = PLATEAU.z + Math.sin(a) * r;
    if (Math.abs(x - NEAR.x) < NEAR.half && Math.abs(z - NEAR.z) < NEAR.half) continue;
    const { h, slope } = heightAndSlope(x, z);
    if (rand() > forestDensity(x, z, h, slope)) continue;
    const height = 9 + rand() * 11;
    m4.compose(
      new THREE.Vector3(x, h - 0.6, z),
      new THREE.Quaternion(),
      new THREE.Vector3(height * bake.aspect * 1.1, height, 1),
    );
    mesh.setMatrixAt(n, m4);
    mesh.setColorAt(
      n,
      colour.setHSL(0.3 + rand() * 0.05, 0.25 + rand() * 0.2, 0.55 + rand() * 0.25),
    );
    n++;
  }
  mesh.count = n;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * The lake: dark peaty water that mirrors the sky, with ripples and the sun's glint. With the
 * bake, it fills exactly the part of the eroded basin under its water line (a flood-filled mask).
 */
function lake(baked: VistaAssets | null) {
  let g: THREE.BufferGeometry;
  let centre = new THREE.Vector3(LAKE.x, LAKE.level, LAKE.z);
  if (baked) {
    const b = baked.info.lake;
    const w = b.x[1] - b.x[0] + 40;
    const d = b.z[1] - b.z[0] + 40;
    g = new THREE.PlaneGeometry(w, d, 1, 1);
    centre = new THREE.Vector3((b.x[0] + b.x[1]) / 2, LAKE.level, (b.z[0] + b.z[1]) / 2);
  } else {
    g = new THREE.CircleGeometry(1, 96);
    g.scale(LAKE.rx * 1.25, LAKE.rz * 1.25, 1);
  }
  g.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x0c1a1c,
    roughness: 0.08,
    metalness: 0,
    envMapIntensity: 1.2,
  });
  const gi = baked?.info.grids.inner;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.lakeMask = { value: baked?.lakeMask ?? null };
    shader.uniforms.lakeRect = {
      value: new THREE.Vector3(gi?.x0 ?? 0, gi?.z0 ?? 0, gi?.size ?? 1),
    };
    mat.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLakeWorld;")
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvLakeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTime;
        varying vec3 vLakeWorld;
        ${baked ? "uniform sampler2D lakeMask;\nuniform vec3 lakeRect;" : ""}`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        ${baked ? "{ vec2 lu = (vLakeWorld.xz - lakeRect.xy) / lakeRect.z; if (texture2D(lakeMask, vec2(lu.x, 1.0 - lu.y)).r < 0.5) discard; }" : ""}`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        {
          vec2 p = vLakeWorld.xz;
          vec2 g = vec2(0.0);
          g += vec2(0.7, 0.3) * cos(dot(p, vec2(0.11, 0.05)) + uTime * 0.6) * 0.012;
          g += vec2(-0.2, 0.9) * cos(dot(p, vec2(-0.07, 0.16)) + uTime * 0.9) * 0.009;
          g += vec2(0.5, -0.6) * cos(dot(p, vec2(0.31, -0.22)) + uTime * 1.4) * 0.005;
          normal = normalize((viewMatrix * vec4(normalize(vec3(-g.x, 1.0, -g.y)), 0.0)).xyz);
        }`,
      );
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.position.copy(centre);
  mesh.receiveShadow = true;
  return mesh;
}

// ---- birds ----------------------------------------------------------------------------------------
interface Flock {
  centre: THREE.Vector3;
  radius: number;
  speed: number;
  phase: number;
  birds: { offset: THREE.Vector3; flap: number }[];
  /** Soaring raptors glide more than they flap. */
  soar: boolean;
}

function birdGeometry() {
  // A body and two wings; wing vertices carry their span (for the flap) in the x coordinate.
  const pos = [
    0,
    0,
    -0.18,
    0.05,
    0,
    0.1,
    -0.05,
    0,
    0.1, // body
    0.04,
    0,
    -0.05,
    0.5,
    0.02,
    0.06,
    0.04,
    0,
    0.1, // right wing
    -0.04,
    0,
    -0.05,
    -0.04,
    0,
    0.1,
    -0.5,
    0.02,
    0.06, // left wing
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export class Birds {
  readonly mesh: THREE.InstancedMesh;
  private flocks: Flock[] = [];
  private time = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  constructor() {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a2724,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      mat.userData.shader = shader;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform float uTime;\nattribute float aFlap;",
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           float span = abs(transformed.x);
           float beat = sin(uTime * 11.0 + aFlap * 6.2831) * (0.5 + 0.5 * step(0.5, fract(aFlap * 7.3)));
           transformed.y += span * span * 2.6 * beat;`,
        );
    };
    const make = (
      centre: [number, number, number],
      radius: number,
      speed: number,
      count: number,
      soar: boolean,
      scale: number,
    ): Flock => ({
      centre: new THREE.Vector3(...centre),
      radius,
      speed,
      phase: Math.random() * 6,
      soar,
      birds: Array.from({ length: count }, (_, i) => ({
        offset: new THREE.Vector3(
          (i % 4) * 2.2 - 3.3 + Math.random(),
          Math.random() * 2,
          Math.floor(i / 4) * 2 + Math.random(),
        ).multiplyScalar(scale),
        flap: Math.random(),
      })),
    });
    this.flocks.push(
      make([-300, -12, 190], 120, 0.09, 11, false, 1),
      make([-420, 10, 300], 200, 0.06, 8, false, 1.2),
      make([-60, 32, 20], 70, 0.12, 7, false, 0.8),
      make([-220, 120, 120], 90, 0.035, 2, true, 3),
      make([-500, 160, 380], 140, 0.03, 2, true, 3),
    );
    const total = this.flocks.reduce((s, f) => s + f.birds.length, 0);
    const geo = birdGeometry();
    const flap = new Float32Array(total);
    let k = 0;
    for (const f of this.flocks) for (const b of f.birds) flap[k++] = f.soar ? 0.07 : b.flap;
    geo.setAttribute("aFlap", new THREE.InstancedBufferAttribute(flap, 1));
    this.mesh = new THREE.InstancedMesh(geo, mat, total);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
  }

  update(dt: number) {
    this.time += dt;
    const shader = (this.mesh.material as THREE.Material).userData.shader;
    if (shader) shader.uniforms.uTime.value = this.time;
    let k = 0;
    for (const f of this.flocks) {
      const t = this.time * f.speed + f.phase;
      // A wandering loop: two circles of different periods, and a slow rise and fall.
      const cx = f.centre.x + Math.cos(t) * f.radius + Math.cos(t * 2.3) * f.radius * 0.25;
      const cz = f.centre.z + Math.sin(t) * f.radius * 0.7 + Math.sin(t * 1.7) * f.radius * 0.2;
      const cy = f.centre.y + Math.sin(t * 1.3) * 6;
      const vx = -Math.sin(t) * f.radius - Math.sin(t * 2.3) * f.radius * 0.575;
      const vz = Math.cos(t) * f.radius * 0.7 + Math.cos(t * 1.7) * f.radius * 0.34;
      const yaw = Math.atan2(vx, vz);
      const bank = f.soar ? 0.35 : Math.sin(t * 3) * 0.2;
      this.e.set(0, yaw, bank, "YXZ");
      this.q.setFromEuler(this.e);
      const scale = f.soar ? 3.2 : 1.3;
      for (const b of f.birds) {
        const o = b.offset.clone().applyQuaternion(this.q);
        const wobble = Math.sin(this.time * 1.7 + b.flap * 9) * 0.6;
        this.m4.compose(
          new THREE.Vector3(cx + o.x, cy + o.y + wobble, cz + o.z),
          this.q,
          new THREE.Vector3(scale, scale, scale),
        );
        this.mesh.setMatrixAt(k++, this.m4);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** How far the land reaches (m from the near square's centre). */
const FAR = 7200;

export class Vista {
  readonly group = new THREE.Group();
  readonly birds = new Birds();
  /** Everything GTAO and the shadow map should skip. */
  readonly land: THREE.Object3D;
  private water: THREE.Mesh;
  private time = 0;

  constructor(
    renderer: THREE.WebGLRenderer,
    sun: THREE.Vector3,
    treeMats: { trunk: THREE.Material; foliage: THREE.Material },
    detail: number,
    baked: VistaAssets | null,
  ) {
    this.water = lake(baked);
    this.land = baked ? bakedLand(baked, detail) : farLand(detail);
    const trees = baked
      ? bakedForest(renderer, sun, treeMats, baked, detail)
      : forests(renderer, sun, treeMats, detail);
    this.group.add(this.land, trees, this.water, this.birds.mesh);
  }

  /** Dim the baked light with the scene's hush (0 … 1). */
  hush(k: number) {
    const u = (this.land as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>).material
      .uniforms?.hush;
    if (u) u.value = 1 - 0.45 * k;
  }

  update(dt: number) {
    this.time += dt;
    const shader = (this.water.material as THREE.Material).userData.shader;
    if (shader) shader.uniforms.uTime.value = this.time;
    this.birds.update(dt);
  }
}
