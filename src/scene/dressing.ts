import * as THREE from "three";
import { CHECKPOINTS, LOGS, type PathPoint, pointAt, TRAIL_LENGTH } from "../game/trail";
import { felt, matte, PALETTE, paintedWood } from "./materials";
import type { Ground } from "./terrain";

// Set dressing: springy grass that leans with the wind, felt pines, rocks, the authored logs,
// checkpoint flags and the lookout platform where tea is taken.

export const windUniforms = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(0, 0) },
  uSway: { value: 1 },
};

function swaying(mat: THREE.MeshStandardMaterial) {
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
        vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float bend = position.y * position.y;
        float s = sin(uTime * 2.3 + wp.x * 0.7 + wp.z * 0.5) * 0.12 * uSway;
        transformed.x += bend * (s + uWind.x);
        transformed.z += bend * (s * 0.6 + uWind.y);`,
      );
  };
  return mat;
}

let seed = 11;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

function scatter(
  ground: Ground,
  count: number,
  area: { cx: number; cz: number; size: number },
  accept: (dist: number, x: number, z: number) => boolean,
) {
  const out: { x: number; y: number; z: number }[] = [];
  let tries = 0;
  while (out.length < count && tries < count * 30) {
    tries++;
    const x = area.cx + (rand() - 0.5) * area.size;
    const z = area.cz + (rand() - 0.5) * area.size;
    const q = ground.query(x, z);
    if (accept(q.dist, x, z) && q.near.d < TRAIL_LENGTH + 12) out.push({ x, y: q.height, z });
  }
  return out;
}

export function buildDressing(ground: Ground, path: readonly PathPoint[], mobile: boolean) {
  const group = new THREE.Group();
  const area = { cx: -18, cz: 24, size: 110 };
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const e = new THREE.Euler();

  // Grass tufts: three crossed blades per tuft, bending from the root.
  const blade = new THREE.ConeGeometry(0.05, 0.4, 3, 1, true);
  blade.translate(0, 0.2, 0);
  const tuftGeo = mergeBlades(blade);
  const grassMat = swaying(
    new THREE.MeshStandardMaterial({ color: 0x8fae4a, roughness: 0.9, side: THREE.DoubleSide }),
  );
  const tufts = scatter(ground, mobile ? 1600 : 3200, area, (d) => d > 1.05 && d < 22);
  const grass = new THREE.InstancedMesh(tuftGeo, grassMat, tufts.length);
  const tint = new THREE.Color();
  tufts.forEach((t, i) => {
    const k = 0.7 + rand() * 0.9;
    m4.compose(p.set(t.x, t.y, t.z), q.identity(), s.set(k, k * (0.7 + rand() * 0.8), k));
    grass.setMatrixAt(i, m4);
    grass.setColorAt(i, tint.setHSL(0.2 + rand() * 0.06, 0.45, 0.35 + rand() * 0.15));
  });
  grass.receiveShadow = true;
  group.add(grass);

  // Flowers: tiny painted-wood buttons on the grass.
  const flowerPts = scatter(ground, mobile ? 160 : 320, area, (d) => d > 1.3 && d < 14);
  const flowers = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.05, 8, 6),
    matte(0xffffff, 0.7),
    flowerPts.length,
  );
  const flowerColors = [0xf2d24a, 0xf4f0e6, 0xe07a8a, 0x9a8ae0];
  flowerPts.forEach((f, i) => {
    m4.compose(p.set(f.x, f.y + 0.2 + rand() * 0.1, f.z), q.identity(), s.set(1, 0.6, 1));
    flowers.setMatrixAt(i, m4);
    flowers.setColorAt(i, tint.set(flowerColors[i % flowerColors.length] as number));
  });
  group.add(flowers);

  // Felt pines, kept back from the trail so the camera sees every obstacle.
  const trunk = new THREE.CylinderGeometry(0.12, 0.16, 1, 8).translate(0, 0.5, 0);
  const crown = new THREE.ConeGeometry(1, 1.6, 9).translate(0, 0.8, 0);
  const pinePts = scatter(ground, mobile ? 70 : 120, area, (d) => d > 7.5);
  const trunks = new THREE.InstancedMesh(trunk, felt(PALETTE.bark, 0.3), pinePts.length);
  const crowns = new THREE.InstancedMesh(crown, felt(PALETTE.pine, 0.6), pinePts.length * 3);
  pinePts.forEach((t, i) => {
    const k = 0.8 + rand() * 1.1;
    m4.compose(p.set(t.x, t.y - 0.1, t.z), q.identity(), s.set(k, k * 1.2, k));
    trunks.setMatrixAt(i, m4);
    for (let j = 0; j < 3; j++) {
      const r = k * (1.1 - j * 0.28);
      m4.compose(
        p.set(t.x, t.y + k * (0.9 + j * 0.75), t.z),
        q.setFromEuler(e.set(0, rand() * 3, 0)),
        s.set(r, k, r),
      );
      crowns.setMatrixAt(i * 3 + j, m4);
      crowns.setColorAt(i * 3 + j, tint.setHSL(0.36 + rand() * 0.05, 0.3, 0.26 + j * 0.04));
    }
  });
  for (const m of [trunks, crowns]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  // Rocks.
  const rockPts = scatter(ground, 60, area, (d) => d > 1.4 && d < 12);
  const rocks = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.4, 1),
    matte(PALETTE.rock, 0.85),
    rockPts.length,
  );
  rockPts.forEach((r, i) => {
    const k = 0.3 + rand() * 0.9;
    m4.compose(
      p.set(r.x, r.y, r.z),
      q.setFromEuler(e.set(rand(), rand() * 6, rand())),
      s.set(k, k * 0.6, k),
    );
    rocks.setMatrixAt(i, m4);
  });
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  group.add(rocks);

  group.add(buildLogs(path));
  const flags = buildFlags(path);
  group.add(flags.group);
  group.add(buildLookout(path));
  return { group, flags: flags.items };
}

function mergeBlades(blade: THREE.BufferGeometry) {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const b = blade.clone();
    b.rotateZ((i - 1) * 0.35);
    b.rotateY((i / 3) * Math.PI);
    parts.push(b);
  }
  const pos: number[] = [];
  const nor: number[] = [];
  for (const b of parts) {
    const g = b.toNonIndexed();
    pos.push(...(g.getAttribute("position").array as Float32Array));
    nor.push(...(g.getAttribute("normal").array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

function buildLogs(path: readonly PathPoint[]) {
  const g = new THREE.Group();
  const bark = felt(PALETTE.bark, 0.3);
  const cut = paintedWood(0xd8b27a);
  for (const log of LOGS) {
    const pt = pointAt(path, log.at);
    const holder = new THREE.Group();
    holder.position.set(pt.x, pt.y, pt.z);
    holder.rotation.y = pt.heading;
    // The log sits higher on the side opposite its lurch: you stumble downhill.
    holder.rotation.z = log.lurch * 0.1;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 2.4, 14), bark);
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.12;
    body.castShadow = body.receiveShadow = true;
    holder.add(body);
    for (const x of [-1.2, 1.2]) {
      const end = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 14), cut);
      end.rotation.z = Math.PI / 2;
      end.position.set(x, 0.12, 0);
      holder.add(end);
    }
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2), matte(PALETTE.rock));
    stone.position.set(-log.lurch * 1.0, 0.02, 0);
    stone.castShadow = true;
    holder.add(stone);
    g.add(holder);
  }
  return g;
}

function buildFlags(path: readonly PathPoint[]) {
  const group = new THREE.Group();
  const items: THREE.Mesh[] = [];
  const pole = paintedWood(0xe8e0cc);
  for (const at of CHECKPOINTS.slice(1)) {
    const pt = pointAt(path, at);
    const rx = Math.cos(pt.heading);
    const rz = -Math.sin(pt.heading);
    const g = new THREE.Group();
    g.position.set(pt.x + rx * 1.25, pt.y, pt.z + rz * 1.25);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 8), pole);
    stick.position.y = 0.65;
    stick.castShadow = true;
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.45, 0.28),
      new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.9, side: THREE.DoubleSide }),
    );
    flag.position.set(0.24, 1.14, 0);
    flag.rotation.y = pt.heading;
    g.add(stick, flag);
    items.push(flag);
    group.add(g);
  }
  return { group, items };
}

function buildLookout(path: readonly PathPoint[]) {
  const end = pointAt(path, TRAIL_LENGTH + 1.5);
  const g = new THREE.Group();
  g.position.set(end.x, end.y, end.z);
  g.rotation.y = end.heading;
  const plank = paintedWood(0xb98a52);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.12, 3.6), plank);
  deck.position.y = -0.04;
  deck.receiveShadow = deck.castShadow = true;
  g.add(deck);
  const rail = paintedWood(0x6d4a2c);
  for (const [x, z, w, d] of [
    [0, -1.8, 4.2, 0.08],
    [-2.1, 0, 0.08, 3.6],
    [2.1, 0, 0.08, 3.6],
  ] as const) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, d), rail);
    bar.position.set(x, 0.75, z);
    bar.castShadow = true;
    g.add(bar);
  }
  for (const [x, z] of [
    [-2.1, -1.8],
    [2.1, -1.8],
    [-2.1, 1.8],
    [2.1, 1.8],
    [0, -1.8],
  ] as const) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.1), rail);
    post.position.set(x, 0.4, z);
    post.castShadow = true;
    g.add(post);
  }
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.05), paintedWood(0x3f6a45));
  sign.position.set(-1.6, 1.25, 1.9);
  const signPost = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.3, 0.07), rail);
  signPost.position.set(-1.6, 0.65, 1.9);
  g.add(sign, signPost);
  return g;
}
