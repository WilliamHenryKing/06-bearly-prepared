import * as THREE from "three";
import { LEDGE, type PathPoint, TRAIL_LENGTH } from "../game/trail";
import { fibreBump, PALETTE } from "./materials";

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

export function buildTerrain(ground: Ground, center: THREE.Vector2, size: number, segs: number) {
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(PALETTE.grass);
  const moss = new THREE.Color(PALETTE.moss);
  const rock = new THREE.Color(PALETTE.rock);
  const dirt = new THREE.Color(PALETTE.dirt);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + center.x;
    const z = pos.getZ(i) + center.y;
    const q = ground.query(x, z);
    pos.setXYZ(i, x, q.height, z);
    c.copy(grass).lerp(moss, 0.5 + 0.5 * Math.sin(x * 0.3 + z * 0.2));
    const steep = Math.min(1, Math.abs(q.height - q.near.y) / 3);
    if (q.near.d > LEDGE.from - 2 && q.near.d < LEDGE.to + 2) c.lerp(rock, steep * 0.9);
    c.lerp(dirt, (1 - smooth(0.9, 1.8, q.dist)) * 0.7);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const bump = fibreBump.clone();
  bump.repeat.set(size / 3, size / 3);
  bump.needsUpdate = true;
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      bumpMap: bump,
      bumpScale: 2,
    }),
  );
  mesh.receiveShadow = true;
  return mesh;
}

/** A painted-dirt ribbon laid along the trail. */
export function buildTrail(path: readonly PathPoint[], length: number) {
  const pts = path.filter((p) => p.d <= length - 0.6);
  const verts: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  pts.forEach((p, i) => {
    const narrow = p.d > LEDGE.from && p.d < LEDGE.to ? 0.62 : 0.85;
    const w = narrow + Math.sin(p.d * 1.3) * 0.05;
    const rx = Math.cos(p.heading);
    const rz = -Math.sin(p.heading);
    verts.push(p.x - rx * w, p.y + 0.03, p.z - rz * w, p.x + rx * w, p.y + 0.03, p.z + rz * w);
    uvs.push(0, p.d * 0.5, 1, p.d * 0.5);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const bump = fibreBump.clone();
  bump.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({
    color: PALETTE.dirt,
    roughness: 1,
    bumpMap: bump,
    bumpScale: 3,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/** A painterly sky dome with distant felt mountains. */
export function buildSky() {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(400, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x7fb2cf) },
        horizon: { value: new THREE.Color(0xf3e6c8) },
      },
      vertexShader:
        "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader:
        "uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float t = smoothstep(-0.05, 0.55, vP.y); gl_FragColor = vec4(mix(horizon, top, t), 1.0); }",
    }),
  );
  g.add(dome);
  const ridge = new THREE.MeshStandardMaterial({
    color: 0x7890a0,
    roughness: 1,
    flatShading: true,
  });
  const snow = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 1, flatShading: true });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.3;
    const r = 120 + (i % 3) * 25;
    const h = 30 + ((i * 37) % 5) * 9;
    const m = new THREE.Mesh(new THREE.ConeGeometry(34 + (i % 4) * 6, h, 7), ridge);
    m.position.set(Math.cos(a) * r - 18, h / 2 - 8, Math.sin(a) * r + 22);
    m.rotation.y = i;
    g.add(m);
    const cap = new THREE.Mesh(new THREE.ConeGeometry((34 + (i % 4) * 6) * 0.3, h * 0.3, 7), snow);
    cap.position.set(m.position.x, h - 8 - h * 0.15 + 0.1, m.position.z);
    cap.rotation.y = i;
    g.add(cap);
  }
  return g;
}
