// Signed-distance modelling for the studio pipeline (docs/STUDIO-PIPELINE.md). A copy of this
// kit lives in each project's tools/studio/kit/ (project-local; synced from the collection's
// tools/studio-kit/). Units are metres. Every node has a distance function, a material
// function (evaluated only at surface vertices) and an axis-aligned bound, so the mesher can
// size its grid automatically.

export type Vec3 = [number, number, number];
/** Linear colour (0–1), roughness and metalness of a surface point. */
export type Mat = { c: Vec3; r: number; m: number };
export type Box = [number, number, number, number, number, number];
export type Node = {
  d: (x: number, y: number, z: number) => number;
  mat: (x: number, y: number, z: number) => Mat;
  box: Box;
};

const DEFAULT: Mat = { c: [0.6, 0.6, 0.6], r: 0.6, m: 0 };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const hex = (value: number): Vec3 => {
  const s = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return [s(((value >> 16) & 255) / 255), s(((value >> 8) & 255) / 255), s((value & 255) / 255)];
};
export const mat = (colour: number | Vec3, roughness = 0.6, metalness = 0): Mat => ({
  c: typeof colour === "number" ? hex(colour) : colour,
  r: roughness,
  m: metalness,
});
const lerpMat = (a: Mat, b: Mat, t: number): Mat => ({
  c: [mix(a.c[0], b.c[0], t), mix(a.c[1], b.c[1], t), mix(a.c[2], b.c[2], t)],
  r: mix(a.r, b.r, t),
  m: mix(a.m, b.m, t),
});

// ---- seeded randomness and noise ------------------------------------------------------------
export function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
const hash3 = (x: number, y: number, z: number, seed: number) => {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** Smooth value noise in [-1, 1]. */
export function noise3(x: number, y: number, z: number, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const c = (i: number, j: number, k: number) => hash3(xi + i, yi + j, zi + k, seed);
  const x00 = mix(c(0, 0, 0), c(1, 0, 0), u);
  const x10 = mix(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = mix(c(0, 0, 1), c(1, 0, 1), u);
  const x11 = mix(c(0, 1, 1), c(1, 1, 1), u);
  return mix(mix(x00, x10, v), mix(x01, x11, v), w) * 2 - 1;
}
export function fbm(x: number, y: number, z: number, octaves = 4, seed = 0) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x * f, y * f, z * f, seed + i * 17);
    amp *= 0.5;
    f *= 2.03;
  }
  return sum;
}

// ---- bounds helpers ---------------------------------------------------------------------------
const pad = (b: Box, e: number): Box => [b[0] - e, b[1] - e, b[2] - e, b[3] + e, b[4] + e, b[5] + e];
const merge = (a: Box, b: Box): Box => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.min(a[2], b[2]),
  Math.max(a[3], b[3]),
  Math.max(a[4], b[4]),
  Math.max(a[5], b[5]),
];
const cube = (r: number): Box => [-r, -r, -r, r, r, r];
const constMat = (m: Mat) => () => m;

// ---- primitives (centred at the origin unless stated) ------------------------------------------
export const sphere = (r: number, m: Mat = DEFAULT): Node => ({
  d: (x, y, z) => Math.hypot(x, y, z) - r,
  mat: constMat(m),
  box: cube(r),
});
export const ellipsoid = (rx: number, ry: number, rz: number, m: Mat = DEFAULT): Node => ({
  d: (x, y, z) => {
    const k0 = Math.hypot(x / rx, y / ry, z / rz);
    const k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
    return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
  },
  mat: constMat(m),
  box: [-rx, -ry, -rz, rx, ry, rz],
});
/** Box of full size sx × sy × sz with rounded edges of radius `round`. */
export const box = (sx: number, sy: number, sz: number, round = 0, m: Mat = DEFAULT): Node => {
  const hx = sx / 2 - round;
  const hy = sy / 2 - round;
  const hz = sz / 2 - round;
  return {
    d: (x, y, z) => {
      const qx = Math.abs(x) - hx;
      const qy = Math.abs(y) - hy;
      const qz = Math.abs(z) - hz;
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
      return outside + Math.min(Math.max(qx, qy, qz), 0) - round;
    },
    mat: constMat(m),
    box: [-sx / 2, -sy / 2, -sz / 2, sx / 2, sy / 2, sz / 2],
  };
};
/** Capsule between two points (world coordinates), radius r (or r0→r1 tapered). */
export const capsule = (a: Vec3, b: Vec3, r0: number, r1 = r0, m: Mat = DEFAULT): Node => {
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const baz = b[2] - a[2];
  const len2 = bax * bax + bay * bay + baz * baz || 1e-9;
  const rmax = Math.max(r0, r1);
  return {
    d: (x, y, z) => {
      const pax = x - a[0];
      const pay = y - a[1];
      const paz = z - a[2];
      const h = clamp((pax * bax + pay * bay + paz * baz) / len2, 0, 1);
      return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - mix(r0, r1, h);
    },
    mat: constMat(m),
    box: [
      Math.min(a[0], b[0]) - rmax,
      Math.min(a[1], b[1]) - rmax,
      Math.min(a[2], b[2]) - rmax,
      Math.max(a[0], b[0]) + rmax,
      Math.max(a[1], b[1]) + rmax,
      Math.max(a[2], b[2]) + rmax,
    ],
  };
};
/** Cylinder along Y, radius r, full height h, rounded edges. */
export const cylinder = (r: number, h: number, round = 0, m: Mat = DEFAULT): Node => ({
  d: (x, y, z) => {
    const dx = Math.hypot(x, z) - (r - round);
    const dy = Math.abs(y) - (h / 2 - round);
    return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - round;
  },
  mat: constMat(m),
  box: [-r, -h / 2, -r, r, h / 2, r],
});
/** Capped cone along Y from radius r0 at the bottom to r1 at the top, full height h. */
export const cone = (r0: number, r1: number, h: number, m: Mat = DEFAULT): Node =>
  lathe(
    [
      [0, -h / 2],
      [r0, -h / 2],
      [r1, h / 2],
      [0, h / 2],
    ],
    0,
    m,
    true,
  );
/** Torus in the XZ plane: ring radius R, tube radius r. */
export const torus = (R: number, r: number, m: Mat = DEFAULT): Node => ({
  d: (x, y, z) => Math.hypot(Math.hypot(x, z) - R, y) - r,
  mat: constMat(m),
  box: [-R - r, -r, -R - r, R + r, r, R + r],
});

// ---- 2D profiles: lathe and extrusion ------------------------------------------------------------
type P2 = [number, number];
function segDist(px: number, py: number, a: P2, b: P2) {
  const bx = b[0] - a[0];
  const by = b[1] - a[1];
  const h = clamp(((px - a[0]) * bx + (py - a[1]) * by) / (bx * bx + by * by || 1e-9), 0, 1);
  return Math.hypot(px - a[0] - bx * h, py - a[1] - by * h);
}
/** Signed distance to a closed polygon (negative inside). */
export function polygon2(points: P2[]) {
  return (px: number, py: number) => {
    let d = Infinity;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[j] as P2;
      const b = points[i] as P2;
      d = Math.min(d, segDist(px, py, a, b));
      if (a[1] > py !== b[1] > py && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0])
        inside = !inside;
    }
    return inside ? -d : d;
  };
}
/**
 * Revolve a profile of [radius, y] points about Y. `solid` treats it as a closed polygon;
 * otherwise it is a shell of half-thickness `thickness` (pots, shades, bells).
 */
export function lathe(profile: P2[], thickness: number, m: Mat = DEFAULT, solid = false): Node {
  const poly = polygon2(profile);
  let rmax = 0;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [r, y] of profile) {
    rmax = Math.max(rmax, r);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const e = thickness;
  return {
    d: solid
      ? (x, y, z) => poly(Math.hypot(x, z), y)
      : (x, y, z) => {
          const q = Math.hypot(x, z);
          let d = Infinity;
          for (let i = 1; i < profile.length; i++)
            d = Math.min(d, segDist(q, y, profile[i - 1] as P2, profile[i] as P2));
          return d - e;
        },
    mat: constMat(m),
    box: [-rmax - e, y0 - e, -rmax - e, rmax + e, y1 + e, rmax + e],
  };
}
/** Extrude a 2D signed-distance shape (in XY, bounded by `extent`) along Z by `depth`. */
export function extrude(
  shape: (x: number, y: number) => number,
  extent: [number, number, number, number],
  depth: number,
  round = 0,
  m: Mat = DEFAULT,
): Node {
  const hz = depth / 2 - round;
  return {
    d: (x, y, z) => {
      const d2 = shape(x, y);
      const dz = Math.abs(z) - hz;
      return (
        Math.min(Math.max(d2 + round, dz), 0) +
        Math.hypot(Math.max(d2 + round, 0), Math.max(dz, 0)) -
        round
      );
    },
    mat: constMat(m),
    box: [extent[0], extent[1], -depth / 2, extent[2], extent[3], depth / 2],
  };
}

// ---- transforms ----------------------------------------------------------------------------------
export const move = (n: Node, t: Vec3): Node => ({
  d: (x, y, z) => n.d(x - t[0], y - t[1], z - t[2]),
  mat: (x, y, z) => n.mat(x - t[0], y - t[1], z - t[2]),
  box: [n.box[0] + t[0], n.box[1] + t[1], n.box[2] + t[2], n.box[3] + t[0], n.box[4] + t[1], n.box[5] + t[2]],
});
/** Rotate by Euler angles (radians, applied X then Y then Z). */
export function rotate(n: Node, [rx, ry, rz]: Vec3): Node {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rx), Math.sin(rx), Math.cos(ry), Math.sin(ry), Math.cos(rz), Math.sin(rz)];
  // Inverse rotation applied to the sample point: Rx⁻¹ Ry⁻¹ Rz⁻¹.
  const inv = (x: number, y: number, z: number): Vec3 => {
    const x1 = cz * x + sz * y;
    const y1 = -sz * x + cz * y;
    const x2 = cy * x1 - sy * z;
    const z2 = sy * x1 + cy * z;
    return [x2, cx * y1 + sx * z2, -sx * y1 + cx * z2];
  };
  const fwd = (x: number, y: number, z: number): Vec3 => {
    const y1 = cx * y - sx * z;
    const z1 = sx * y + cx * z;
    const x2 = cy * x + sy * z1;
    const z2 = -sy * x + cy * z1;
    return [cz * x2 - sz * y1, sz * x2 + cz * y1, z2];
  };
  let box: Box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const p = fwd(n.box[i & 1 ? 3 : 0], n.box[i & 2 ? 4 : 1], n.box[i & 4 ? 5 : 2]);
    box = [Math.min(box[0], p[0]), Math.min(box[1], p[1]), Math.min(box[2], p[2]), Math.max(box[3], p[0]), Math.max(box[4], p[1]), Math.max(box[5], p[2])];
  }
  return {
    d: (x, y, z) => {
      const p = inv(x, y, z);
      return n.d(p[0], p[1], p[2]);
    },
    mat: (x, y, z) => {
      const p = inv(x, y, z);
      return n.mat(p[0], p[1], p[2]);
    },
    box,
  };
}
export const scale = (n: Node, s: number): Node => ({
  d: (x, y, z) => n.d(x / s, y / s, z / s) * s,
  mat: (x, y, z) => n.mat(x / s, y / s, z / s),
  box: [n.box[0] * s, n.box[1] * s, n.box[2] * s, n.box[3] * s, n.box[4] * s, n.box[5] * s],
});
/** Mirror across the YZ plane (symmetric models: build the +X half). */
export const mirrorX = (n: Node): Node => ({
  d: (x, y, z) => n.d(Math.abs(x), y, z),
  mat: (x, y, z) => n.mat(Math.abs(x), y, z),
  box: [-Math.max(Math.abs(n.box[0]), Math.abs(n.box[3])), n.box[1], n.box[2], Math.max(Math.abs(n.box[0]), Math.abs(n.box[3])), n.box[4], n.box[5]],
});
/** Bend around Z: x-positions curve upward by k (1/m). */
export const bend = (n: Node, k: number): Node => {
  const warp = (x: number, y: number): [number, number] => {
    const c = Math.cos(k * x);
    const s = Math.sin(k * x);
    return [c * x - s * y, s * x + c * y];
  };
  const extra = Math.abs(k) * Math.max(Math.abs(n.box[0]), Math.abs(n.box[3])) ** 2;
  return {
    d: (x, y, z) => {
      const [bx, by] = warp(x, y);
      return n.d(bx, by, z) * 0.8;
    },
    mat: (x, y, z) => {
      const [bx, by] = warp(x, y);
      return n.mat(bx, by, z);
    },
    box: pad(n.box, extra + 0.01),
  };
};

// ---- combinations ------------------------------------------------------------------------------
export function union(...nodes: Node[]): Node {
  return {
    d: (x, y, z) => {
      let d = Infinity;
      for (const n of nodes) d = Math.min(d, n.d(x, y, z));
      return d;
    },
    mat: (x, y, z) => {
      let best = nodes[0] as Node;
      let d = Infinity;
      for (const n of nodes) {
        const v = n.d(x, y, z);
        if (v < d) {
          d = v;
          best = n;
        }
      }
      return best.mat(x, y, z);
    },
    box: nodes.reduce<Box>((b, n) => merge(b, n.box), [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]),
  };
}
/** Polynomial smooth union with blend radius k; materials blend across the seam. */
export function blend(k: number, ...nodes: Node[]): Node {
  const combine = (x: number, y: number, z: number) => {
    let d = (nodes[0] as Node).d(x, y, z);
    let m = (nodes[0] as Node).mat(x, y, z);
    for (let i = 1; i < nodes.length; i++) {
      const n = nodes[i] as Node;
      const d2 = n.d(x, y, z);
      const h = clamp(0.5 + (0.5 * (d2 - d)) / k, 0, 1);
      m = lerpMat(n.mat(x, y, z), m, h);
      d = mix(d2, d, h) - k * h * (1 - h);
    }
    return { d, m };
  };
  return {
    d: (x, y, z) => {
      let d = (nodes[0] as Node).d(x, y, z);
      for (let i = 1; i < nodes.length; i++) {
        const d2 = (nodes[i] as Node).d(x, y, z);
        const h = clamp(0.5 + (0.5 * (d2 - d)) / k, 0, 1);
        d = mix(d2, d, h) - k * h * (1 - h);
      }
      return d;
    },
    mat: (x, y, z) => combine(x, y, z).m,
    box: pad(nodes.reduce<Box>((b, n) => merge(b, n.box), [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]), k),
  };
}
export const subtract = (a: Node, ...cuts: Node[]): Node => ({
  d: (x, y, z) => {
    let d = a.d(x, y, z);
    for (const c of cuts) d = Math.max(d, -c.d(x, y, z));
    return d;
  },
  mat: a.mat,
  box: a.box,
});
/** Smooth subtraction; the cut's material shows on the carved faces when `inner` is given. */
export const carve = (k: number, a: Node, cut: Node, inner?: Mat): Node => ({
  d: (x, y, z) => {
    // Smooth subtraction (after Quilez): h → 0 far from the cut, keeping the base.
    const d1 = a.d(x, y, z);
    const d2 = -cut.d(x, y, z);
    const h = clamp(0.5 - (0.5 * (d1 - d2)) / k, 0, 1);
    return mix(d1, d2, h) + k * h * (1 - h);
  },
  mat: inner
    ? (x, y, z) => (-cut.d(x, y, z) > a.d(x, y, z) - k * 0.5 ? inner : a.mat(x, y, z))
    : a.mat,
  box: a.box,
});
export const intersect = (a: Node, b: Node): Node => ({
  d: (x, y, z) => Math.max(a.d(x, y, z), b.d(x, y, z)),
  mat: a.mat,
  box: [Math.max(a.box[0], b.box[0]), Math.max(a.box[1], b.box[1]), Math.max(a.box[2], b.box[2]), Math.min(a.box[3], b.box[3]), Math.min(a.box[4], b.box[4]), Math.min(a.box[5], b.box[5])],
});
/** Hollow a solid into a shell of thickness t. */
export const shell = (n: Node, t: number): Node => ({
  d: (x, y, z) => Math.abs(n.d(x, y, z)) - t / 2,
  mat: n.mat,
  box: pad(n.box, t),
});
/** Surface displacement by fBm noise: amplitude (m), frequency (1/m). */
export const displace = (n: Node, amp: number, freq: number, octaves = 4, seed = 0): Node => ({
  d: (x, y, z) => n.d(x, y, z) + amp * fbm(x * freq, y * freq, z * freq, octaves, seed),
  mat: n.mat,
  box: pad(n.box, amp),
});
/** Replace the material with a procedural one: fn(x, y, z, base) → Mat. */
export const paint = (n: Node, fn: (x: number, y: number, z: number, base: Mat) => Mat): Node => ({
  d: n.d,
  mat: (x, y, z) => fn(x, y, z, n.mat(x, y, z)),
  box: n.box,
});
export const tint = (n: Node, m: Mat): Node => ({ d: n.d, mat: () => m, box: n.box });
/** Material variation: jitter colour by noise (amount 0–1) at a frequency. */
export const mottle = (n: Node, amount: number, freq: number, seed = 0): Node =>
  paint(n, (x, y, z, base) => {
    const v = 1 + amount * fbm(x * freq, y * freq, z * freq, 3, seed);
    return { ...base, c: [base.c[0] * v, base.c[1] * v, base.c[2] * v] };
  });
/** Repeat a node n times around the Y axis (gears, petals, scallops), starting at angle 0. */
export function radial(n: Node, count: number): Node {
  const step = (Math.PI * 2) / count;
  const fold = (x: number, z: number): [number, number] => {
    const a = Math.atan2(z, x);
    const k = Math.round(a / step);
    const b = a - k * step;
    const r = Math.hypot(x, z);
    return [Math.cos(b) * r, Math.sin(b) * r];
  };
  const r = Math.max(...n.box.map(Math.abs));
  return {
    d: (x, y, z) => {
      const [fx, fz] = fold(x, z);
      return n.d(fx, y, fz);
    },
    mat: (x, y, z) => {
      const [fx, fz] = fold(x, z);
      return n.mat(fx, y, fz);
    },
    box: [-r, n.box[1], -r, r, n.box[4], r],
  };
}
/** A chain of capsules through points (stems, branches, handles, cables). */
export function chain(points: Vec3[], r0: number, r1: number, m: Mat = DEFAULT, k = 0): Node {
  const parts: Node[] = [];
  for (let i = 1; i < points.length; i++) {
    const t0 = (i - 1) / (points.length - 1);
    const t1 = i / (points.length - 1);
    parts.push(capsule(points[i - 1] as Vec3, points[i] as Vec3, mix(r0, r1, t0), mix(r0, r1, t1), m));
  }
  return k > 0 ? blend(k, ...parts) : union(...parts);
}
