// Surface-nets meshing of an SDF node, vertex shading bakes (ambient occlusion, cavity and
// edge wear from the field itself) and a minimal binary glTF writer. Studio pipeline kit.
import type { Mat, Node } from "./sdf";

export type Mesh = {
  positions: Float32Array;
  normals: Float32Array;
  colours: Uint16Array; // RGBA, linear, normalised 16-bit (glTF COLOR_0 is linear)
  material: Uint8Array; // roughness, metalness, ambient occlusion, wear
  indices: Uint32Array;
};

const unit16 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 65535);

/**
 * Mesh `node` on a grid of `voxel`-sized cells covering its bounds. Options: `wear` lightens
 * convex edges, `dirt` darkens cavities (0–1 each).
 */
export function meshNode(node: Node, voxel: number, options: { wear?: number; dirt?: number } = {}): Mesh {
  const [x0, y0, z0, x1, y1, z1] = node.box;
  const padding = voxel * 2;
  const ox = x0 - padding;
  const oy = y0 - padding;
  const oz = z0 - padding;
  const nx = Math.ceil((x1 - x0 + 2 * padding) / voxel) + 1;
  const ny = Math.ceil((y1 - y0 + 2 * padding) / voxel) + 1;
  const nz = Math.ceil((z1 - z0 + 2 * padding) / voxel) + 1;
  if (nx * ny * nz > 60_000_000) throw new Error(`grid too large: ${nx}×${ny}×${nz}`);
  const field = new Float32Array(nx * ny * nz);
  const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) field[at(i, j, k)] = node.d(ox + i * voxel, oy + j * voxel, oz + k * voxel);

  // One vertex per cell that straddles the surface, at the mean of its edge crossings.
  const cellVertex = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cell = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos: number[] = [];
  const corners = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [a, b, e] = corners[c] as number[];
          const value = field[at(i + (a as number), j + (b as number), k + (e as number))] as number;
          v[c] = value;
          if (value < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let count = 0;
        for (const [a, b] of edges as [number, number][]) {
          const va = v[a] as number;
          const vb = v[b] as number;
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const ca = corners[a] as number[];
          const cb = corners[b] as number[];
          sx += (ca[0] as number) + ((cb[0] as number) - (ca[0] as number)) * t;
          sy += (ca[1] as number) + ((cb[1] as number) - (ca[1] as number)) * t;
          sz += (ca[2] as number) + ((cb[2] as number) - (ca[2] as number)) * t;
          count++;
        }
        cellVertex[cell(i, j, k)] = pos.length / 3;
        pos.push(ox + (i + sx / count) * voxel, oy + (j + sy / count) * voxel, oz + (k + sz / count) * voxel);
      }

  // Quads across every grid edge with a sign change, wound so faces point out of the solid.
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c);
    else idx.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const inside = (field[at(i, j, k)] as number) < 0;
        if (inside !== (field[at(i + 1, j, k)] as number) < 0)
          quad(cellVertex[cell(i, j - 1, k - 1)] as number, cellVertex[cell(i, j, k - 1)] as number, cellVertex[cell(i, j, k)] as number, cellVertex[cell(i, j - 1, k)] as number, !inside);
        if (inside !== (field[at(i, j + 1, k)] as number) < 0)
          quad(cellVertex[cell(i - 1, j, k - 1)] as number, cellVertex[cell(i - 1, j, k)] as number, cellVertex[cell(i, j, k)] as number, cellVertex[cell(i, j, k - 1)] as number, !inside);
        if (inside !== (field[at(i, j, k + 1)] as number) < 0)
          quad(cellVertex[cell(i - 1, j - 1, k)] as number, cellVertex[cell(i, j - 1, k)] as number, cellVertex[cell(i, j, k)] as number, cellVertex[cell(i - 1, j, k)] as number, !inside);
      }

  // Per-vertex normals, material, ambient occlusion, cavity and edge wear from the field.
  const count = pos.length / 3;
  const positions = new Float32Array(pos);
  const normals = new Float32Array(count * 3);
  const colours = new Uint16Array(count * 4);
  const material = new Uint8Array(count * 4);
  const e = voxel * 0.5;
  const wear = options.wear ?? 0.35;
  const dirt = options.dirt ?? 0.35;
  for (let n = 0; n < count; n++) {
    const x = positions[n * 3] as number;
    const y = positions[n * 3 + 1] as number;
    const z = positions[n * 3 + 2] as number;
    const d0 = node.d(x, y, z);
    const dx = node.d(x + e, y, z) - node.d(x - e, y, z);
    const dy = node.d(x, y + e, z) - node.d(x, y - e, z);
    const dz = node.d(x, y, z + e) - node.d(x, y, z - e);
    const len = Math.hypot(dx, dy, dz) || 1;
    const gx = dx / len;
    const gy = dy / len;
    const gz = dz / len;
    normals.set([gx, gy, gz], n * 3);
    // Ambient occlusion: how much the field closes in along the normal (after Quilez).
    let occlusion = 0;
    let weight = 1;
    for (let s = 1; s <= 5; s++) {
      const h = voxel * 1.5 * s * s * 0.5;
      occlusion += (h - node.d(x + gx * h, y + gy * h, z + gz * h)) * weight;
      weight *= 0.6;
    }
    const ao = Math.max(0, Math.min(1, 1 - (occlusion / voxel) * 0.35));
    // Curvature from the Laplacian of the field: positive on convex edges, negative in creases.
    const h = voxel * 1.5;
    const lap =
      (node.d(x + h, y, z) + node.d(x - h, y, z) + node.d(x, y + h, z) + node.d(x, y - h, z) + node.d(x, y, z + h) + node.d(x, y, z - h) - 6 * d0) /
      (h * h);
    const curvature = lap * voxel;
    const edge = Math.max(0, Math.min(1, curvature * 2.2)) * wear;
    const cavity = Math.max(0, Math.min(1, -curvature * 2.2)) * dirt;
    const m: Mat = node.mat(x, y, z);
    const shade = (1 - cavity * 0.6) * (0.55 + 0.45 * ao);
    const lift = 1 + edge * 0.55;
    colours.set([unit16(m.c[0] * shade * lift), unit16(m.c[1] * shade * lift), unit16(m.c[2] * shade * lift), 65535], n * 4);
    material.set(
      [Math.round(Math.min(1, m.r + cavity * 0.15 - edge * 0.1) * 255), Math.round(m.m * 255), Math.round(ao * 255), Math.round(edge * 255)],
      n * 4,
    );
  }
  return { positions, normals, colours, material, indices: new Uint32Array(idx) };
}

/** Binary glTF 2.0 with POSITION, NORMAL, COLOR_0, _MATERIAL (r, m, ao, wear) and indices. */
export function toGlb(mesh: Mesh, extras: Record<string, unknown> = {}): Uint8Array {
  const count = mesh.positions.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++)
    for (let c = 0; c < 3; c++) {
      const value = mesh.positions[i * 3 + c] as number;
      if (value < (min[c] as number)) min[c] = value;
      if (value > (max[c] as number)) max[c] = value;
    }
  const chunks = [mesh.positions, mesh.normals, mesh.colours, mesh.material, mesh.indices].map(
    (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
  );
  let offset = 0;
  const views = chunks.map((chunk, i) => {
    const view = { buffer: 0, byteOffset: offset, byteLength: chunk.byteLength, target: i === 4 ? 34963 : 34962 };
    offset += Math.ceil(chunk.byteLength / 4) * 4;
    return view;
  });
  const bin = new Uint8Array(offset);
  chunks.forEach((chunk, i) => {
    bin.set(chunk, (views[i] as { byteOffset: number }).byteOffset);
  });
  const json = {
    asset: { version: "2.0", generator: "studio-kit (thirteen worlds and games)" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: String(extras.id ?? "asset") }],
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2, _MATERIAL: 3 }, indices: 4, material: 0 },
        ],
        extras,
      },
    ],
    materials: [{ name: "vertex", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5126, count, type: "VEC3" },
      { bufferView: 2, componentType: 5123, normalized: true, count, type: "VEC4" },
      { bufferView: 3, componentType: 5121, normalized: true, count, type: "VEC4" },
      { bufferView: 4, componentType: 5125, count: mesh.indices.length, type: "SCALAR" },
    ],
  };
  let text = JSON.stringify(json);
  while (text.length % 4) text += " ";
  const jsonBytes = new TextEncoder().encode(text);
  const total = 12 + 8 + jsonBytes.byteLength + 8 + bin.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.byteLength, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const binStart = 20 + jsonBytes.byteLength;
  dv.setUint32(binStart, bin.byteLength, true);
  dv.setUint32(binStart + 4, 0x004e4942, true);
  out.set(bin, binStart + 8);
  return out;
}
