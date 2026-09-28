import * as THREE from "three";
import { LEDGE, type PathPoint, TRAIL_LENGTH } from "../game/trail";
import { applySet, type PbrSet } from "./textures";

// Ground shaped around the authored trail: the path is carved flat, hills roll away from it,
// and along the ledge one side drops into the valley while the other rises into a rock wall.

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const noise = (x: number, z: number) =>
  Math.sin(x * 0.21 + Math.sin(z * 0.13) * 1.7) * 0.6 +
  Math.sin(z * 0.17 - x * 0.07) * 0.5 +
  Math.sin((x + z) * 0.53) * 0.12;

export interface GroundQuery {
  /** Distance to the trail centre line. */
  dist: number;
  /** Signed sideways offset from the nearest trail point, positive to the walker's right. */
  side: number;
  near: PathPoint;
  height: number;
}

export class Ground {
  private coarse: PathPoint[];

  constructor(path: readonly PathPoint[]) {
    this.coarse = path.filter((_, i) => i % 3 === 0);
  }

  query(x: number, z: number): GroundQuery {
    let best = Number.POSITIVE_INFINITY;
    let near = this.coarse[0] as PathPoint;
    let wSum = 0;
    let ySum = 0;
    for (const p of this.coarse) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < best) {
        best = d;
        near = p;
      }
      const w = Math.exp(-d / 2.5);
      wSum += w;
      ySum += w * p.y;
    }
    const base = wSum > 1e-9 ? ySum / wSum : near.y;
    const rx = Math.cos(near.heading);
    const rz = -Math.sin(near.heading);
    const side = (x - near.x) * rx + (z - near.z) * rz;
    const flat = 1 - smooth(1.1, 7, best);
    const hills = base + noise(x, z) * 0.8 + Math.max(0, best - 7) * 0.22;
    let h = near.y * flat + hills * (1 - flat) - 0.04;
    const ledge =
      smooth(LEDGE.from - 3, LEDGE.from + 2, near.d) *
      (1 - smooth(LEDGE.to - 2, LEDGE.to + 3, near.d));
    if (ledge > 0) {
      const drop = -7 * smooth(1.1, 4.5, -side) - Math.max(0, -side - 4.5) * 0.4;
      const wall = 2.6 * smooth(1.2, 4, side) + noise(x * 2, z * 2) * 0.4 * smooth(1.5, 4, side);
      const shaped = near.y - 0.04 + (side < 0 ? drop : wall);
      h = h * (1 - ledge) + shaped * ledge;
    }
    // Past the lookout deck the ground falls away and the valley opens up.
    const view = smooth(TRAIL_LENGTH + 2, TRAIL_LENGTH + 7, near.d);
    if (view > 0) h = h * (1 - view) + (near.y - 9 - Math.max(0, best - 3) * 0.35) * view;
    return { dist: best, side, near, height: h };
  }

  height(x: number, z: number) {
    return this.query(x, z).height;
  }
}

/** The meadow mesh; vertex colours carry blend weights for the ground material. */
export function buildTerrain(
  ground: Ground,
  center: THREE.Vector2,
  size: number,
  segs: number,
  material: THREE.Material,
) {
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + center.x;
    const z = pos.getZ(i) + center.y;
    const q = ground.query(x, z);
    pos.setXYZ(i, x, q.height, z);
    const steep = Math.min(1, Math.abs(q.height - q.near.y) / 2.5);
    const onLedge = q.near.d > LEDGE.from - 3 && q.near.d < LEDGE.to + 3 ? 1 : 0;
    const rock = Math.max(onLedge * steep, smooth(4, 12, q.height - q.near.y - q.dist * 0.18));
    const dirt = 1 - smooth(0.7, 2.1, q.dist);
    colors.set([1 - rock * 0.25, dirt, rock], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}

/** The trail: a rocky-dirt ribbon whose edges feather into the dirt verge of the meadow. */
export function buildTrail(path: readonly PathPoint[], length: number, set: PbrSet) {
  const pts = path.filter((p) => p.d <= length - 0.6);
  const verts: number[] = [];
  const uvs: number[] = [];
  const cols: number[] = [];
  const idx: number[] = [];
  const across = [-1, -0.7, 0.7, 1];
  pts.forEach((p, i) => {
    const narrow = p.d > LEDGE.from && p.d < LEDGE.to ? 0.62 : 0.85;
    const w = narrow + Math.sin(p.d * 1.3) * 0.05;
    const rx = Math.cos(p.heading);
    const rz = -Math.sin(p.heading);
    for (const a of across) {
      verts.push(p.x + rx * w * a, p.y + 0.025 + (1 - Math.abs(a)) * 0.012, p.z + rz * w * a);
      uvs.push(a * w * 0.45, p.d * 0.45);
      cols.push(1, 1, 1, Math.abs(a) === 1 ? 0 : 1);
    }
    if (i > 0) {
      const b = (i - 1) * 4;
      for (let k = 0; k < 3; k++)
        idx.push(b + k, b + k + 1, b + k + 4, b + k + 1, b + k + 5, b + k + 4);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = applySet(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
    set,
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}
