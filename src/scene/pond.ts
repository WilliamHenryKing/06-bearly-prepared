import * as THREE from "three";
import { type PathPoint, pointAt } from "../game/trail";

// A shallow meadow pond the trail runs straight through, just before the second flag. It is
// scenery only: the rules never see it (the bear's walk, speed and balance are unchanged), but
// the bear wades in thigh-deep, comes out soaked, drips, and shakes itself off. The terrain is
// carved to a bowl with a low bank all round so the water can never spill out; the surface is
// lit by the scene's own light (environment reflection and sun glints) and carries ripple rings
// from every step.

/** Trail distance of the pond's centre, and its shape. */
export const POND = { d: 35.5, side: -0.7, along: 2.3, across: 4.4, depth: 0.36 };
const RINGS = 12;
/** Elliptical radius the fine ground patch reaches out to. */
const PATCH = 1.8;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Pond {
  readonly centre: THREE.Vector3;
  /** Height of the water surface. */
  readonly level: number;
  readonly mesh: THREE.Mesh;
  private fwd: THREE.Vector2;
  private right: THREE.Vector2;
  private rings: THREE.Vector4[] = Array.from(
    { length: RINGS },
    () => new THREE.Vector4(0, 0, 99, 0),
  );
  private next = 0;
  private uniforms = {
    uTime: { value: 0 },
    uRings: { value: this.rings },
  };

  constructor(path: readonly PathPoint[]) {
    const p = pointAt(path, POND.d);
    this.fwd = new THREE.Vector2(-Math.sin(p.heading), -Math.cos(p.heading));
    this.right = new THREE.Vector2(Math.cos(p.heading), -Math.sin(p.heading));
    this.centre = new THREE.Vector3(
      p.x + this.right.x * POND.side,
      p.y,
      p.z + this.right.y * POND.side,
    );
    this.level = p.y - 0.045;
    this.mesh = this.buildSurface();
  }

  /** Elliptical radius: 0 at the centre, about 1 at the shore (with a wandering edge). */
  e(x: number, z: number) {
    const dx = x - this.centre.x;
    const dz = z - this.centre.z;
    const a = (dx * this.fwd.x + dz * this.fwd.y) / POND.along;
    const b = (dx * this.right.x + dz * this.right.y) / POND.across;
    const angle = Math.atan2(b, a);
    const wobble = Math.sin(angle * 3 + 1.3) * 0.06 + Math.sin(angle * 5 - 0.4) * 0.035;
    return Math.hypot(a, b) * (1 + wobble);
  }

  /** The pond bed under the water, or +∞ outside it. */
  floor(x: number, z: number) {
    const e = this.e(x, z);
    if (e >= 1.05) return Number.POSITIVE_INFINITY;
    return this.level - 0.03 - POND.depth * (1 - smooth(0.3, 1.0, e));
  }

  /** Water depth at a point (0 on land). */
  depthAt(x: number, z: number) {
    return Math.max(0, this.level - this.floor(x, z));
  }

  /** Ground shaping: the bowl inside, a low bank around it so the water stays in. */
  carve(x: number, z: number, h: number) {
    const e = this.e(x, z);
    if (e > 1.7) return h;
    const bank = this.level + 0.025 + 0.12 * smooth(1.0, 1.6, e);
    const lifted = Math.max(h, bank + (h - bank) * smooth(1.1, 1.7, e));
    if (e >= 1.0) return e < 1.1 ? Math.max(lifted, this.level + 0.012) : lifted;
    const bed = this.level - 0.03 - POND.depth * (1 - smooth(0.3, 1.0, e));
    return bed;
  }

  /**
   * The ground in and around the pond at 12 cm resolution (the meadow mesh is far coarser), in
   * the meadow's own material: muddy dirt on the bed and banks, darker where it is wet.
   */
  buildPatch(height: (x: number, z: number) => number, material: THREE.Material) {
    const step = 0.12;
    const extentU = POND.along * 1.8;
    const extentV = POND.across * 1.8;
    const nu = Math.ceil((2 * extentU) / step);
    const nv = Math.ceil((2 * extentV) / step);
    const verts: number[] = [];
    const cols: number[] = [];
    const keep: boolean[] = [];
    for (let j = 0; j <= nv; j++)
      for (let i = 0; i <= nu; i++) {
        const u = -extentU + i * step;
        const v = -extentV + j * step;
        const x = this.centre.x + this.fwd.x * u + this.right.x * v;
        const z = this.centre.z + this.fwd.y * u + this.right.y * v;
        const e = this.e(x, z);
        keep.push(e < PATCH);
        verts.push(x, height(x, z) + 0.004, z);
        // Silt on the bed, a thin dark mud rim at the waterline, then the meadow's own turf.
        const under = 1 - smooth(0.85, 1.02, e);
        const mud = 1 - smooth(1.02, 1.22, e);
        cols.push(1 - under * 0.55 - mud * 0.3, mud, 0);
      }
    const index: number[] = [];
    const at = (i: number, j: number) => j * (nu + 1) + i;
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const a = at(i, j);
        const b = at(i + 1, j);
        const c = at(i, j + 1);
        const d = at(i + 1, j + 1);
        if (keep[a] && keep[b] && keep[c] && keep[d]) index.push(a, c, b, b, c, d);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, material);
    mesh.receiveShadow = true;
    return mesh;
  }

  /** True where the fine patch covers the meadow (the meadow mesh hides beneath it there). */
  covers(x: number, z: number) {
    return this.e(x, z) < PATCH - 0.12;
  }

  /** A new ripple ring at a point (a footfall, a drip, a splash). */
  ripple(x: number, z: number, strength = 1) {
    const r = this.rings[this.next] as THREE.Vector4;
    r.set(x, z, 0, strength);
    this.next = (this.next + 1) % RINGS;
  }

  update(dt: number) {
    this.uniforms.uTime.value += dt;
    for (const r of this.rings) r.z += dt;
  }

  private buildSurface() {
    // Concentric rings in the pond's own frame, carrying the water depth for the shader.
    const rings = 14;
    const segs = 72;
    const verts: number[] = [];
    const depth: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= rings; i++) {
      const r = (i / rings) * 1.25;
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const u = Math.cos(a) * r * POND.along;
        const v = Math.sin(a) * r * POND.across;
        const x = this.centre.x + this.fwd.x * u + this.right.x * v;
        const z = this.centre.z + this.fwd.y * u + this.right.y * v;
        verts.push(x, this.level, z);
        depth.push(Math.max(0, this.level - Math.min(this.floor(x, z), this.level + 0.2)));
        if (i > 0) {
          const a0 = (i - 1) * segs + j;
          const a1 = (i - 1) * segs + ((j + 1) % segs);
          const b0 = i * segs + j;
          const b1 = i * segs + ((j + 1) % segs);
          // Wound to face up.
          index.push(a0, a1, b0, a1, b1, b0);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(
        verts.map((_, i) => (i % 3 === 1 ? 1 : 0)),
        3,
      ),
    );
    g.setAttribute("depth", new THREE.Float32BufferAttribute(depth, 1));
    g.setIndex(index);

    const mat = new THREE.MeshStandardMaterial({
      color: 0x14180f,
      roughness: 0.06,
      metalness: 0,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute float depth;\nvarying float vDepth;\nvarying vec3 vWorld;",
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvDepth = depth;\nvWorld = (modelMatrix * vec4(position, 1.0)).xyz;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
uniform float uTime;
uniform vec4 uRings[${RINGS}];
varying float vDepth;
varying vec3 vWorld;`,
        )
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
{
  // Wind ripples (three small travelling waves) and the rings from steps and drips.
  vec2 p = vWorld.xz;
  vec2 grad = vec2(0.0);
  grad += vec2(0.8, 0.6) * cos(dot(p, vec2(9.0, 6.5)) + uTime * 1.7) * 0.012;
  grad += vec2(-0.5, 0.9) * cos(dot(p, vec2(-7.0, 12.0)) + uTime * 2.3) * 0.009;
  grad += vec2(0.9, -0.3) * cos(dot(p, vec2(21.0, -8.0)) + uTime * 3.1) * 0.005;
  for (int i = 0; i < ${RINGS}; i++) {
    vec4 r = uRings[i];
    if (r.z > 4.0) continue;
    vec2 d = p - r.xy;
    float dist = length(d) + 1e-4;
    float radius = 0.08 + r.z * 0.55;
    float x = dist - radius;
    float envelope = exp(-x * x / 0.004) * exp(-r.z * 1.3) * r.w;
    grad += d / dist * cos(x * 48.0) * envelope * 0.35;
  }
  vec3 wn = normalize(vec3(-grad.x, 1.0, -grad.y));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`,
        )
        .replace(
          "#include <opaque_fragment>",
          `#include <opaque_fragment>
{
  // Peaty meadow water: light is absorbed with depth, reflections sit on top (premultiplied).
  float a = 1.0 - exp(-vDepth * 9.0);
  a = clamp(a + 0.12, 0.0, 0.96) * smoothstep(0.0, 0.012, vDepth);
  gl_FragColor = vec4(totalDiffuse * a + totalSpecular, a);
}`,
        );
    };
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    return mesh;
  }
}

/** Water droplets: splashes from steps, drips off wet fur, the spray of a shake. */
export class Droplets {
  readonly mesh: THREE.InstancedMesh;
  private pos: THREE.Vector3[] = [];
  private vel: THREE.Vector3[] = [];
  private life: number[] = [];
  private next = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(
    private max = 260,
    private floorAt: (x: number, z: number) => number,
    private onSplash: (x: number, z: number, strength: number) => void,
  ) {
    const geo = new THREE.SphereGeometry(1, 8, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0xcfe0e8, roughness: 0.05, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < max; i++) {
      this.pos.push(new THREE.Vector3());
      this.vel.push(new THREE.Vector3());
      this.life.push(0);
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    }
  }

  emit(at: THREE.Vector3, velocity: THREE.Vector3, life = 1.6) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    (this.pos[i] as THREE.Vector3).copy(at);
    (this.vel[i] as THREE.Vector3).copy(velocity);
    this.life[i] = life;
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      let life = this.life[i] as number;
      if (life <= 0) continue;
      const p = this.pos[i] as THREE.Vector3;
      const v = this.vel[i] as THREE.Vector3;
      v.y -= 9.81 * dt;
      v.multiplyScalar(1 - dt * 0.6);
      p.addScaledVector(v, dt);
      life -= dt;
      const floor = this.floorAt(p.x, p.z);
      if (p.y <= floor) {
        this.onSplash(p.x, p.z, 0.25);
        life = 0;
      }
      this.life[i] = life;
      // Stretched along the motion, like a falling drop in a sixtieth of a second.
      const speed = v.length();
      this.q.setFromUnitVectors(
        this.up,
        speed > 1e-3 ? this.s.copy(v).divideScalar(speed) : this.up,
      );
      const r = life > 0 ? 0.0045 : 0;
      this.s.set(r, r * (1 + speed * 0.9), r);
      this.mesh.setMatrixAt(i, this.m.compose(p, this.q, this.s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.update(0);
  }
}
