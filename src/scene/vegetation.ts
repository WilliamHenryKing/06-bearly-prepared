import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { LEDGE, type PathPoint, TRAIL_LENGTH } from "../game/trail";
import type { Ground } from "./terrain";
import { loadPbrSet, loadTexture } from "./textures";
import { buildTreeVariant, treeMaterials } from "./trees";

// The meadow's living layer, all instanced with 15-25 % scale, free rotation and slight hue
// jitter: alpha-tested grass cards cut from a scanned blade atlas, shrub card clusters, scanned
// dandelions and mossy rocks, and modelled conifers from the trail out to the far tree line.
// Grass, shrubs and crowns bend in a shared wind that leans with each gust.

export const windUniforms = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(0, 0) },
  uSway: { value: 1 },
};

/** Bend the upper part of each instance; `height` is the height at which bending is full. */
function swaying<T extends THREE.MeshStandardMaterial>(mat: T, height: number, stiffness = 1) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime; uniform vec2 uWind; uniform float uSway;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 root = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          mat3 toLocal = transpose(mat3(instanceMatrix));
        #else
          vec4 root = vec4(0.0);
          mat3 toLocal = mat3(1.0);
        #endif
        float bend = clamp(position.y / ${height.toFixed(2)}, 0.0, 1.0);
        bend = bend * bend * ${stiffness.toFixed(2)};
        float phase = root.x * 0.7 + root.z * 0.53;
        float s = (sin(uTime * 2.1 + phase) * 0.6 + sin(uTime * 3.7 + phase * 1.7) * 0.25) * 0.08 * uSway;
        vec3 push = toLocal * vec3(uWind.x + s, 0.0, uWind.y + s * 0.6);
        transformed += push * bend * ${height.toFixed(2)};`,
      );
  };
  mat.customProgramCacheKey = () => `sway-${height}-${stiffness}`;
  return mat;
}

let seed = 17;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

interface Spot {
  x: number;
  y: number;
  z: number;
  dist: number;
  d: number;
}

function scatter(
  ground: Ground,
  n: number,
  radius: number,
  accept: (s: Spot) => boolean,
  centre = { x: -18, z: 24 },
) {
  const out: Spot[] = [];
  for (let tries = 0; out.length < n && tries < n * 40; tries++) {
    const x = centre.x + (rand() - 0.5) * radius * 2;
    const z = centre.z + (rand() - 0.5) * radius * 2;
    const q = ground.query(x, z);
    const s = { x, y: q.height, z, dist: q.dist, d: q.near.d };
    if (accept(s)) out.push(s);
  }
  return out;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const sc = new THREE.Vector3();
const p = new THREE.Vector3();
const col = new THREE.Color();

function place(mesh: THREE.InstancedMesh, i: number, s: Spot, scale: number, sink = 0, tilt = 0) {
  const k = scale * (0.8 + rand() * 0.4);
  m4.compose(
    p.set(s.x, s.y - sink * k, s.z),
    q.setFromEuler(e.set((rand() - 0.5) * tilt, rand() * Math.PI * 2, (rand() - 0.5) * tilt)),
    sc.setScalar(k),
  );
  mesh.setMatrixAt(i, m4);
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow: boolean) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
  m.count = n;
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

/** A clump of three crossed cards, each carrying the whole blade atlas. */
function cardClump(width: number, height: number, cards: number) {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < cards; i++) {
    const g = new THREE.PlaneGeometry(width, height, 1, 2);
    g.translate(0, height / 2, 0);
    g.rotateY((i / cards) * Math.PI + 0.2);
    parts.push(g);
  }
  const geo = mergeGeometries(parts);
  if (!geo) throw new Error("card merge failed");
  // Up-facing normals so both faces light like a lawn, not like paper.
  const nor = geo.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i < nor.count; i++) nor.setXYZ(i, 0, 1, 0);
  return geo;
}

/** A dome of small leaf cards; UVs sample only the leaf part of the shrub atlas. */
function leafDome(radius: number, cards: number) {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < cards; i++) {
    const g = new THREE.PlaneGeometry(radius * 0.9, radius * 0.9);
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    const u0 = 0.24 + rand() * 0.36;
    for (let j = 0; j < uv.count; j++) uv.setX(j, u0 + uv.getX(j) * 0.4);
    const a = rand() * Math.PI * 2;
    const h = rand() * 0.9;
    const r = radius * Math.sqrt(1 - h * h) * (0.6 + rand() * 0.4);
    g.rotateX(-0.6 + rand() * 0.5);
    g.rotateY(a + Math.PI / 2 + (rand() - 0.5));
    g.translate(Math.cos(a) * r, h * radius * 0.9 + radius * 0.35, Math.sin(a) * r);
    parts.push(g);
  }
  const geo = mergeGeometries(parts);
  if (!geo) throw new Error("leaf merge failed");
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const nor = geo.getAttribute("normal") as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i) - radius * 0.2, pos.getZ(i)).normalize();
    nor.setXYZ(i, v.x, v.y, v.z);
  }
  return geo;
}

async function loadGlb(url: string) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}${url}`);
  gltf.scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  // Bake node transforms and sit each piece on its own base at the origin.
  return meshes.map((m) => {
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    g.computeBoundingBox();
    const b = g.boundingBox as THREE.Box3;
    g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
    g.computeBoundingSphere();
    const material = m.material as THREE.MeshStandardMaterial;
    // The scans pack roughness only; their metalness channel is not metal.
    material.metalness = 0;
    material.metalnessMap = null;
    return { geometry: g, material };
  });
}

export async function buildVegetation(ground: Ground, path: readonly PathPoint[], mobile: boolean) {
  const group = new THREE.Group();
  const k = mobile ? 0.4 : 1;
  const onTrail = (s: Spot) => s.d < TRAIL_LENGTH + 2;
  const offLedgeDrop = (s: Spot) => !(s.d > LEDGE.from - 2 && s.d < LEDGE.to + 2 && s.dist > 1.2);

  const [grassTex, shrubTex, bark, rocks, dandelions] = await Promise.all([
    loadTexture("textures/grass_medium_02/grass_medium_02_cards.webp", true),
    loadTexture("textures/shrub_02/shrub_02_cards.webp", true),
    loadPbrSet("bark_brown_02"),
    loadGlb("models/rock_moss_set_01.glb"),
    loadGlb("models/dandelion_01.glb"),
  ]);

  // Grass: dense along the trail, thinning with distance.
  const grassMat = swaying(
    new THREE.MeshStandardMaterial({
      map: grassTex,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.8,
      color: 0xc8dca0,
    }),
    0.34,
  );
  const tufts = scatter(ground, Math.round(15000 * k), 34, (s) => {
    if (s.dist < 1.05 || !onTrail(s)) return false;
    return rand() < Math.exp(-(s.dist - 1) / 9) + 0.12;
  });
  const grass = instanced(cardClump(0.55, 0.38, 3), grassMat, tufts.length, false);
  tufts.forEach((t, i) => {
    place(grass, i, t, 0.9 + rand() * 0.5, 0.02, 0.25);
    grass.setColorAt(i, col.setHSL(0.2 + rand() * 0.06, 0.25 + rand() * 0.25, 0.42 + rand() * 0.2));
  });
  group.add(grass);

  // Shrubs: leaf-card domes.
  const shrubMat = swaying(
    new THREE.MeshStandardMaterial({
      map: shrubTex,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.75,
    }),
    1.1,
    0.35,
  );
  const shrubGeo = leafDome(0.55, mobile ? 14 : 22);
  const shrubs = scatter(
    ground,
    Math.round(90 * k),
    40,
    (s) => s.dist > 2.5 && onTrail(s) && offLedgeDrop(s),
  );
  const shrub = instanced(shrubGeo, shrubMat, shrubs.length, true);
  shrubs.forEach((t, i) => {
    place(shrub, i, t, 0.7 + rand() * 0.8, 0.05, 0.2);
    shrub.setColorAt(i, col.setHSL(0.22 + rand() * 0.07, 0.3, 0.55 + rand() * 0.15));
  });
  group.add(shrub);

  // Scanned dandelions (the three light variants), in drifts near the path.
  const flowerVariants = dandelions.filter((v) => (v.geometry.index?.count ?? 0) / 3 < 5000);
  const spots = scatter(
    ground,
    Math.round(260 * k),
    26,
    (s) => s.dist > 1.2 && s.dist < 14 && onTrail(s),
  );
  flowerVariants.forEach((v, j) => {
    const mine = spots.filter((_, i) => i % flowerVariants.length === j);
    const mesh = instanced(v.geometry, v.material, mine.length, false);
    mine.forEach((s, i) => {
      place(mesh, i, s, 1.4, 0, 0.3);
    });
    group.add(mesh);
  });

  // Scanned mossy rocks: boulders in the meadow, pebbles on the path verges.
  const rockSpots = scatter(ground, Math.round(70 * k), 40, (s) => s.dist > 1.6 && onTrail(s));
  const pebbles: Spot[] = [];
  for (const pt of path) {
    if (pt.d > TRAIL_LENGTH - 1.5 || rand() > (mobile ? 0.3 : 0.6)) continue;
    const side = rand() > 0.5 ? 1 : -1;
    const off = side * ((pt.d > LEDGE.from && pt.d < LEDGE.to ? 0.7 : 0.95) + rand() * 0.25);
    const x = pt.x + Math.cos(pt.heading) * off;
    const z = pt.z - Math.sin(pt.heading) * off;
    pebbles.push({ x, y: Math.max(pt.y, ground.height(x, z)), z, dist: 1, d: pt.d });
  }
  rocks.forEach((r, j) => {
    const big = rockSpots.filter((_, i) => i % rocks.length === j);
    const small = pebbles.filter((_, i) => i % rocks.length === j);
    const mesh = instanced(r.geometry, r.material, big.length + small.length, true);
    big.forEach((s, i) => {
      place(mesh, i, s, 0.25 + rand() * 0.45, 0.25, 0.6);
    });
    small.forEach((s, i) => {
      place(mesh, big.length + i, s, 0.035 + rand() * 0.05, 0.2, 1.2);
    });
    group.add(mesh);
  });

  // Conifers: three modelled variants, kept back from the trail, plus a far tree line.
  const mats = treeMaterials(bark);
  swaying(mats.foliage, 8, 0.05);
  const variants = [
    buildTreeVariant(6.5, 15, 11),
    buildTreeVariant(8.5, 18, 12),
    buildTreeVariant(5, 13, 10),
  ];
  const near = scatter(
    ground,
    Math.round(120 * k),
    52,
    (s) => s.dist > 7 && s.d < TRAIL_LENGTH + 8,
  );
  const far: Spot[] = [];
  const ring = mobile ? 90 : 200;
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2 + rand() * 0.03;
    const r = 60 + rand() * 18;
    const x = -18 + Math.cos(a) * r;
    const z = 24 + Math.sin(a) * r;
    const g = ground.query(x, z);
    if (g.dist > 12) far.push({ x, y: g.height, z, dist: g.dist, d: g.near.d });
  }
  const all = [...near, ...far];
  variants.forEach((v, j) => {
    const mine = all.filter((_, i) => i % variants.length === j);
    const trunk = instanced(v.trunk, mats.trunk, mine.length, true);
    const crown = instanced(v.foliage, mats.foliage, mine.length, true);
    mine.forEach((s, i) => {
      place(trunk, i, s, 1, 0.1, 0.06);
      trunk.getMatrixAt(i, m4);
      crown.setMatrixAt(i, m4);
      crown.setColorAt(
        i,
        col.setHSL(0.28 + rand() * 0.05, 0.25 + rand() * 0.2, 0.62 + rand() * 0.2),
      );
    });
    group.add(trunk, crown);
  });
  return group;
}
