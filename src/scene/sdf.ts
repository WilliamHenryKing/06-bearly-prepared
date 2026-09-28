// A small signed-distance toolkit for procedural character bodies, after the studio kit
// (tools/studio/kit/sdf.ts), trimmed for runtime use: every node carries an axis-aligned box so
// smooth unions can skip parts that cannot reach the sample point. Metres throughout.

export type Vec3 = [number, number, number];
export type Box = [number, number, number, number, number, number];
export interface Sdf {
  d: (x: number, y: number, z: number) => number;
  box: Box;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Euclidean length; Math.hypot is several times slower in this hot path. */
export const len = (x: number, y: number, z = 0) => Math.sqrt(x * x + y * y + z * z);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const pad = (b: Box, e: number): Box => [
  b[0] - e,
  b[1] - e,
  b[2] - e,
  b[3] + e,
  b[4] + e,
  b[5] + e,
];
const merge = (boxes: Box[]): Box =>
  boxes.reduce<Box>(
    (a, b) => [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.min(a[2], b[2]),
      Math.max(a[3], b[3]),
      Math.max(a[4], b[4]),
      Math.max(a[5], b[5]),
    ],
    [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity],
  );
/** Lower bound of the distance from a point to anything inside the box. */
const boxDistance = (b: Box, x: number, y: number, z: number) =>
  len(
    Math.max(b[0] - x, 0, x - b[3]),
    Math.max(b[1] - y, 0, y - b[4]),
    Math.max(b[2] - z, 0, z - b[5]),
  );

export const sphere = (r: number, c: Vec3): Sdf => ({
  d: (x, y, z) => len(x - c[0], y - c[1], z - c[2]) - r,
  box: [c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1] + r, c[2] + r],
});

export const ellipsoid = (r: Vec3, c: Vec3): Sdf => ({
  d: (x, y, z) => {
    const px = x - c[0];
    const py = y - c[1];
    const pz = z - c[2];
    const k0 = len(px / r[0], py / r[1], pz / r[2]);
    const k1 = len(px / (r[0] * r[0]), py / (r[1] * r[1]), pz / (r[2] * r[2]));
    return k1 === 0 ? -Math.min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1;
  },
  box: [c[0] - r[0], c[1] - r[1], c[2] - r[2], c[0] + r[0], c[1] + r[1], c[2] + r[2]],
});

/** Capsule from a to b, radius tapering r0 → r1. */
export const capsule = (a: Vec3, b: Vec3, r0: number, r1 = r0): Sdf => {
  const bx = b[0] - a[0];
  const by = b[1] - a[1];
  const bz = b[2] - a[2];
  const len2 = bx * bx + by * by + bz * bz || 1e-9;
  const r = Math.max(r0, r1);
  return {
    d: (x, y, z) => {
      const px = x - a[0];
      const py = y - a[1];
      const pz = z - a[2];
      const h = clamp((px * bx + py * by + pz * bz) / len2, 0, 1);
      return len(px - bx * h, py - by * h, pz - bz * h) - mix(r0, r1, h);
    },
    box: [
      Math.min(a[0], b[0]) - r,
      Math.min(a[1], b[1]) - r,
      Math.min(a[2], b[2]) - r,
      Math.max(a[0], b[0]) + r,
      Math.max(a[1], b[1]) + r,
      Math.max(a[2], b[2]) + r,
    ],
  };
};

/** Rotation by Euler angles (X, then Y, then Z) about the pivot. */
export function rotateAbout(n: Sdf, [rx, ry, rz]: Vec3, pivot: Vec3): Sdf {
  const inv = rotationInverse([rx, ry, rz]);
  // A conservative box: the node's box rotated is contained in a sphere around the pivot.
  const r = Math.max(
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      len(
        n.box[i & 1 ? 3 : 0] - pivot[0],
        n.box[i & 2 ? 4 : 1] - pivot[1],
        n.box[i & 4 ? 5 : 2] - pivot[2],
      ),
    ),
  );
  return {
    d: (x, y, z) => {
      const p = inv(x - pivot[0], y - pivot[1], z - pivot[2]);
      return n.d(p[0] + pivot[0], p[1] + pivot[1], p[2] + pivot[2]);
    },
    box: [pivot[0] - r, pivot[1] - r, pivot[2] - r, pivot[0] + r, pivot[1] + r, pivot[2] + r],
  };
}

/** The inverse of an X-then-Y-then-Z Euler rotation, as a function of a vector. */
export function rotationInverse([rx, ry, rz]: Vec3) {
  const [cx, sx, cy, sy, cz, sz] = [
    Math.cos(rx),
    Math.sin(rx),
    Math.cos(ry),
    Math.sin(ry),
    Math.cos(rz),
    Math.sin(rz),
  ];
  return (x: number, y: number, z: number): Vec3 => {
    const x1 = cz * x + sz * y;
    const y1 = -sz * x + cz * y;
    const x2 = cy * x1 - sy * z;
    const z2 = sy * x1 + cy * z;
    return [x2, cx * y1 + sx * z2, -sx * y1 + cx * z2];
  };
}

export const union = (...nodes: Sdf[]): Sdf => ({
  d: (x, y, z) => {
    let d = Infinity;
    for (const n of nodes) d = Math.min(d, n.d(x, y, z));
    return d;
  },
  box: merge(nodes.map((n) => n.box)),
});

/**
 * Polynomial smooth union with blend radius k. A part whose box lies at least k beyond the
 * current distance cannot change the result, so it is skipped without evaluating its field.
 */
export function blend(k: number, ...nodes: Sdf[]): Sdf {
  const first = nodes[0] as Sdf;
  const rest = nodes.slice(1);
  return {
    d: (x, y, z) => {
      let d = first.d(x, y, z);
      for (const n of rest) {
        if (boxDistance(n.box, x, y, z) >= d + k) continue;
        const d2 = n.d(x, y, z);
        const h = clamp(0.5 + (0.5 * (d2 - d)) / k, 0, 1);
        d = mix(d2, d, h) - k * h * (1 - h);
      }
      return d;
    },
    box: pad(merge(nodes.map((n) => n.box)), k),
  };
}

/** Smooth subtraction of `cut` from `a` (after Quilez). */
export const carve = (k: number, a: Sdf, cut: Sdf): Sdf => ({
  d: (x, y, z) => {
    const d1 = a.d(x, y, z);
    if (boxDistance(cut.box, x, y, z) >= k) return d1;
    const d2 = -cut.d(x, y, z);
    const h = clamp(0.5 - (0.5 * (d1 - d2)) / k, 0, 1);
    return mix(d1, d2, h) + k * h * (1 - h);
  },
  box: a.box,
});

/** Keeps the part of `a` above the plane y = h (a flat sole). */
export const above = (a: Sdf, h: number): Sdf => ({
  d: (x, y, z) => Math.max(a.d(x, y, z), h - y),
  box: [a.box[0], Math.max(a.box[1], h), a.box[2], a.box[3], a.box[4], a.box[5]],
});

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
  const u = (x - xi) ** 2 * (3 - 2 * (x - xi));
  const v = (y - yi) ** 2 * (3 - 2 * (y - yi));
  const w = (z - zi) ** 2 * (3 - 2 * (z - zi));
  const c = (i: number, j: number, k: number) => hash3(xi + i, yi + j, zi + k, seed);
  const a = mix(mix(c(0, 0, 0), c(1, 0, 0), u), mix(c(0, 1, 0), c(1, 1, 0), u), v);
  const b = mix(mix(c(0, 0, 1), c(1, 0, 1), u), mix(c(0, 1, 1), c(1, 1, 1), u), v);
  return mix(a, b, w) * 2 - 1;
}

export interface NetMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * Surface nets over the node's box: one vertex per sign-changing cell at the mean of its edge
 * crossings, a quad across every sign-changing grid edge, wound outward.
 */
export function surfaceNets(node: Sdf, voxel: number): NetMesh {
  const [x0, y0, z0, x1, y1, z1] = node.box;
  const padding = voxel * 2;
  const ox = x0 - padding;
  const oy = y0 - padding;
  const oz = z0 - padding;
  const nx = Math.ceil((x1 - x0 + 2 * padding) / voxel) + 1;
  const ny = Math.ceil((y1 - y0 + 2 * padding) / voxel) + 1;
  const nz = Math.ceil((z1 - z0 + 2 * padding) / voxel) + 1;
  const field = new Float32Array(nx * ny * nz);
  const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  // Coarse pass first: a block of S³ cells whose corners are all farther from the surface than
  // the block's diagonal cannot contain it (distance changes no faster than position), so its
  // interior only needs the sign, taken from the corners. Only blocks near the surface get the
  // exact field.
  const S = 4;
  const cx = Math.ceil((nx - 1) / S) + 1;
  const cy = Math.ceil((ny - 1) / S) + 1;
  const cz = Math.ceil((nz - 1) / S) + 1;
  const coarse = new Float32Array(cx * cy * cz);
  const cat = (i: number, j: number, k: number) => i + cx * (j + cy * k);
  for (let k = 0; k < cz; k++)
    for (let j = 0; j < cy; j++)
      for (let i = 0; i < cx; i++)
        coarse[cat(i, j, k)] = node.d(ox + i * S * voxel, oy + j * S * voxel, oz + k * S * voxel);
  const reach = S * voxel * Math.sqrt(3) * 1.25;
  const near: number[] = [];
  for (let bk = 0; bk < cz - 1; bk++)
    for (let bj = 0; bj < cy - 1; bj++)
      for (let bi = 0; bi < cx - 1; bi++) {
        let close = false;
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          const value = coarse[
            cat(bi + (c & 1), bj + ((c >> 1) & 1), bk + ((c >> 2) & 1))
          ] as number;
          if (Math.abs(value) < reach) close = true;
          if (value < 0) inside++;
        }
        if (close) {
          near.push(bi, bj, bk);
          continue;
        }
        const fill = inside > 0 ? -reach : reach;
        for (let k = bk * S; k <= Math.min(nz - 1, bk * S + S); k++)
          for (let j = bj * S; j <= Math.min(ny - 1, bj * S + S); j++)
            for (let i = bi * S; i <= Math.min(nx - 1, bi * S + S); i++) field[at(i, j, k)] = fill;
      }
  // Exact values last, so they win on faces shared with far blocks (each point once).
  const done = new Uint8Array(nx * ny * nz);
  for (let b = 0; b < near.length; b += 3) {
    const bi = near[b] as number;
    const bj = near[b + 1] as number;
    const bk = near[b + 2] as number;
    for (let k = bk * S; k <= Math.min(nz - 1, bk * S + S); k++)
      for (let j = bj * S; j <= Math.min(ny - 1, bj * S + S); j++)
        for (let i = bi * S; i <= Math.min(nx - 1, bi * S + S); i++) {
          const a = at(i, j, k);
          if (done[a]) continue;
          done[a] = 1;
          field[a] = node.d(ox + i * voxel, oy + j * voxel, oz + k * voxel);
        }
  }

  const cells = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cell = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos: number[] = [];
  const corner = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1];
  const edges = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const value = field[
            at(
              i + (corner[c * 3] as number),
              j + (corner[c * 3 + 1] as number),
              k + (corner[c * 3 + 2] as number),
            )
          ] as number;
          v[c] = value;
          if (value < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (let e = 0; e < 12; e++) {
          const a = edges[e * 2] as number;
          const b = edges[e * 2 + 1] as number;
          const va = v[a] as number;
          const vb = v[b] as number;
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx +=
            (corner[a * 3] as number) + ((corner[b * 3] as number) - (corner[a * 3] as number)) * t;
          sy +=
            (corner[a * 3 + 1] as number) +
            ((corner[b * 3 + 1] as number) - (corner[a * 3 + 1] as number)) * t;
          sz +=
            (corner[a * 3 + 2] as number) +
            ((corner[b * 3 + 2] as number) - (corner[a * 3 + 2] as number)) * t;
          n++;
        }
        cells[cell(i, j, k)] = pos.length / 3;
        pos.push(ox + (i + sx / n) * voxel, oy + (j + sy / n) * voxel, oz + (k + sz / n) * voxel);
      }

  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c);
    else idx.push(a, b, c, a, c, d);
  };
  const cv = (i: number, j: number, k: number) => cells[cell(i, j, k)] as number;
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const inside = (field[at(i, j, k)] as number) < 0;
        if (inside !== (field[at(i + 1, j, k)] as number) < 0)
          quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k), !inside);
        if (inside !== (field[at(i, j + 1, k)] as number) < 0)
          quad(cv(i - 1, j, k - 1), cv(i - 1, j, k), cv(i, j, k), cv(i, j, k - 1), !inside);
        if (inside !== (field[at(i, j, k + 1)] as number) < 0)
          quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k), !inside);
      }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}
