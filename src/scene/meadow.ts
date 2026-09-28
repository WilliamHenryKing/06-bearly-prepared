import * as THREE from "three";
import { LEDGE, type PathPoint, TRAIL_LENGTH } from "../game/trail";
import { scatter } from "./dressing";
import { felt, matte } from "./materials";
import type { Ground } from "./terrain";

// Meadow richness, all instanced so phones stay smooth: stemmed wildflowers, felt bushes,
// varied rocks, pebbles lining the path, a tree line on the far hills and slow clouds.

let seed = 29;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const s = new THREE.Vector3();
const p = new THREE.Vector3();
const e = new THREE.Euler();
const c = new THREE.Color();

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow = true) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
  m.count = n;
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

export class Meadow {
  readonly group = new THREE.Group();
  private clouds = new THREE.Group();

  constructor(ground: Ground, path: readonly PathPoint[], mobile: boolean) {
    const area = { cx: -18, cz: 24, size: 100 };
    const k = mobile ? 0.5 : 1;

    // Wildflowers on thin stems, in drifts of one colour.
    const spots = scatter(ground, Math.round(420 * k), area, (d) => d > 1.2 && d < 16);
    const stems = instanced(
      new THREE.CylinderGeometry(0.006, 0.008, 1, 4).translate(0, 0.5, 0),
      matte(0x5f7a3a),
      spots.length,
      false,
    );
    const heads = instanced(
      new THREE.IcosahedronGeometry(0.045, 0),
      matte(0xffffff, 0.7),
      spots.length,
      false,
    );
    const petals = [0xf2d24a, 0xf4f0e6, 0xe07a8a, 0x9a8ae0, 0xe89a4a];
    spots.forEach((f, i) => {
      const h = 0.18 + rand() * 0.2;
      m4.compose(p.set(f.x, f.y, f.z), q.identity(), s.set(1, h, 1));
      stems.setMatrixAt(i, m4);
      m4.compose(p.set(f.x, f.y + h, f.z), q.identity(), s.setScalar(0.8 + rand() * 0.6));
      heads.setMatrixAt(i, m4);
      const drift = Math.floor((Math.sin(f.x * 0.21) + Math.cos(f.z * 0.17) + 2) * 1.2);
      heads.setColorAt(
        i,
        c.set(petals[(drift + (rand() > 0.8 ? 1 : 0)) % petals.length] as number),
      );
    });
    this.group.add(stems, heads);

    // Felt bushes: three soft lumps each.
    const bushSpots = scatter(ground, Math.round(70 * k), area, (d) => d > 3 && d < 18);
    const bushes = instanced(
      new THREE.IcosahedronGeometry(0.4, 1),
      felt(0x557a3c, 0.5),
      bushSpots.length * 3,
    );
    bushSpots.forEach((b, i) => {
      const size = 0.6 + rand() * 0.8;
      for (let j = 0; j < 3; j++) {
        const a = rand() * Math.PI * 2;
        const r = size * (0.7 - j * 0.15);
        m4.compose(
          p.set(
            b.x + Math.cos(a) * size * 0.35 * j,
            b.y + r * 0.35,
            b.z + Math.sin(a) * size * 0.35 * j,
          ),
          q.setFromEuler(e.set(0, rand() * 3, 0)),
          s.set(r, r * 0.8, r),
        );
        bushes.setMatrixAt(i * 3 + j, m4);
        bushes.setColorAt(i * 3 + j, c.setHSL(0.26 + rand() * 0.06, 0.35, 0.28 + rand() * 0.08));
      }
    });
    this.group.add(bushes);

    // Rocks in varied greys and warm stones.
    const rockSpots = scatter(ground, Math.round(80 * k), area, (d) => d > 1.6 && d < 20);
    const rocks = instanced(
      new THREE.DodecahedronGeometry(0.3, 0),
      matte(0xffffff, 0.9),
      rockSpots.length,
    );
    const stone = [0x8f887c, 0xa39a88, 0x7d7a74, 0xb5a58a];
    rockSpots.forEach((r, i) => {
      const k2 = 0.25 + rand() ** 2 * 1.4;
      m4.compose(
        p.set(r.x, r.y - k2 * 0.05, r.z),
        q.setFromEuler(e.set(rand(), rand() * 6, rand())),
        s.set(k2 * (1 + rand() * 0.6), k2 * 0.55, k2),
      );
      rocks.setMatrixAt(i, m4);
      rocks.setColorAt(i, c.set(stone[i % stone.length] as number));
    });
    this.group.add(rocks);

    // Pebbles along both edges of the path.
    const edge: THREE.Vector3[] = [];
    for (const pt of path) {
      if (pt.d > TRAIL_LENGTH - 1.5 || rand() > (mobile ? 0.45 : 0.8)) continue;
      const onLedge = pt.d > LEDGE.from && pt.d < LEDGE.to;
      const w = onLedge ? 0.72 : 0.95;
      for (const side of [-1, 1]) {
        const off = side * (w + rand() * 0.12);
        const x = pt.x + Math.cos(pt.heading) * off;
        const z = pt.z - Math.sin(pt.heading) * off;
        edge.push(new THREE.Vector3(x, Math.max(pt.y, ground.height(x, z)) + 0.02, z));
      }
    }
    const pebbles = instanced(
      new THREE.DodecahedronGeometry(0.07, 0),
      matte(0xc9bda4, 0.85),
      edge.length,
      false,
    );
    edge.forEach((v, i) => {
      const k3 = 0.6 + rand() * 0.9;
      m4.compose(v, q.setFromEuler(e.set(rand(), rand() * 6, 0)), s.set(k3 * 1.3, k3 * 0.6, k3));
      pebbles.setMatrixAt(i, m4);
      pebbles.setColorAt(i, c.set(rand() > 0.5 ? 0xd8ccb2 : 0xb8ab92));
    });
    this.group.add(pebbles);

    // A tree line on the far hills.
    const ring = mobile ? 110 : 190;
    const far = instanced(
      new THREE.ConeGeometry(1.4, 4.5, 7).translate(0, 2.2, 0),
      felt(0x3a5e44, 0.3),
      ring,
      false,
    );
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2 + rand() * 0.02;
      const r = 62 + rand() * 18;
      const x = area.cx + Math.cos(a) * r;
      const z = area.cz + Math.sin(a) * r;
      const y = ground.height(x, z);
      const h = 1 + rand() * 1.2;
      m4.compose(p.set(x, y - 0.5, z), q.identity(), s.set(h, h * (0.9 + rand() * 0.5), h));
      far.setMatrixAt(i, m4);
      far.setColorAt(i, c.setHSL(0.37 + rand() * 0.04, 0.25, 0.22 + rand() * 0.08));
    }
    this.group.add(far);

    // Soft clouds: clusters of flattened puffs, unfogged so they stay bright.
    const puff = new THREE.SphereGeometry(1, 14, 10);
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xfffaf0,
      roughness: 1,
      emissive: 0x6a6660,
      fog: false,
    });
    for (let i = 0; i < (mobile ? 8 : 14); i++) {
      const cloud = new THREE.Group();
      const a = (i / 14) * Math.PI * 2 + rand();
      const r = 150 + rand() * 90;
      cloud.position.set(area.cx + Math.cos(a) * r, 50 + rand() * 30, area.cz + Math.sin(a) * r);
      for (let j = 0; j < 5; j++) {
        const m = new THREE.Mesh(puff, cloudMat);
        const sz = 8 + rand() * 9;
        m.scale.set(sz * 1.5, sz * 0.55, sz);
        m.position.set((j - 2) * 9 + rand() * 4, rand() * 3, rand() * 6);
        cloud.add(m);
      }
      cloud.lookAt(area.cx, cloud.position.y, area.cz);
      this.clouds.add(cloud);
    }
    this.clouds.position.set(0, 0, 0);
    this.group.add(this.clouds);
  }

  update(dt: number, calm: boolean) {
    if (!calm) this.clouds.rotation.y += dt * 0.004;
  }
}
