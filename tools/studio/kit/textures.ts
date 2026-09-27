// Procedural tileable PBR texture synthesis (colour, normal, roughness PNGs) and a minimal PNG
// encoder. Every layer is periodic over the tile, so maps repeat without seams. Studio kit.
import { deflateSync } from "node:zlib";

export type TextureRecipe = {
  id: string;
  /** Base colour ramp (sRGB hex): noise value 0 → 1 maps across these stops. */
  ramp: number[];
  /** Features, summed into the height field that also drives the colour ramp. */
  layers: (
    | { kind: "fbm"; scale: number; octaves?: number; weight?: number }
    | { kind: "fibres"; scale: number; stretch: number; angle?: number; weight?: number }
    | { kind: "cells"; count: number; weight?: number; crack?: boolean }
    | { kind: "grain"; rings: number; warp?: number; weight?: number }
    | { kind: "weave"; count: number; weight?: number }
  )[];
  roughness: [number, number];
  normal?: number;
  seed?: number;
};

// ---- periodic noise -----------------------------------------------------------------------------
const hash = (x: number, y: number, seed: number) => {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const wrap = (v: number, period: number) => ((v % period) + period) % period;
/** Value noise periodic over `period` lattice cells, in [0, 1]. */
function pnoise(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const c = (i: number, j: number) => hash(wrap(xi + i, period), wrap(yi + j, period), seed);
  const a = c(0, 0) + (c(1, 0) - c(0, 0)) * u;
  const b = c(0, 1) + (c(1, 1) - c(0, 1)) * u;
  return a + (b - a) * v;
}
function pfbm(x: number, y: number, period: number, octaves: number, seed: number) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let p = period;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * pnoise(x * f, y * f, p, seed + i * 31);
    norm += amp;
    amp *= 0.5;
    f *= 2;
    p *= 2;
  }
  return sum / norm;
}
/** Periodic Worley: distance to nearest and second-nearest feature points (tile units). */
function pcells(u: number, v: number, count: number, seed: number): [number, number] {
  const x = u * count;
  const y = v * count;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let d1 = 9;
  let d2 = 9;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const cy = yi + j;
      const px = cx + hash(wrap(cx, count), wrap(cy, count), seed);
      const py = cy + hash(wrap(cx, count), wrap(cy, count), seed + 7);
      const d = Math.hypot(px - x, py - y);
      if (d < d1) {
        d2 = d1;
        d1 = d;
      } else if (d < d2) d2 = d;
    }
  return [d1, d2];
}

// ---- synthesis ------------------------------------------------------------------------------------
const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const srgb = (v: number) => {
  const c = Math.max(0, Math.min(1, v));
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
};

export function synthesise(recipe: TextureRecipe, size: number) {
  const seed = recipe.seed ?? 7;
  const height = new Float32Array(size * size);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let h = 0;
      recipe.layers.forEach((layer, index) => {
        const w = layer.weight ?? 1;
        const s = seed + index * 101;
        if (layer.kind === "fbm") h += w * pfbm(u * layer.scale, v * layer.scale, layer.scale, layer.octaves ?? 5, s);
        else if (layer.kind === "fibres") {
          // Stretched noise along an axis-aligned direction keeps the tile periodic.
          const across = layer.scale * layer.stretch;
          h += w * (layer.angle ? pfbm(v * layer.scale, u * across, layer.scale, 4, s) : pfbm(u * layer.scale, v * across, layer.scale, 4, s));
        } else if (layer.kind === "cells") {
          const [d1, d2] = pcells(u, v, layer.count, s);
          h += w * (layer.crack ? Math.min(1, (d2 - d1) * 6) : 1 - Math.min(1, d1 * 1.4));
        } else if (layer.kind === "grain") {
          const warp = (layer.warp ?? 1.5) * pfbm(u * 4, v * 4, 4, 4, s);
          h += w * (0.5 + 0.5 * Math.sin((v * layer.rings + warp) * Math.PI * 2));
        } else if (layer.kind === "weave") {
          const a = Math.sin(u * layer.count * Math.PI * 2);
          const b = Math.sin(v * layer.count * Math.PI * 2);
          h += w * (0.5 + 0.25 * (Math.sign(a * b) * Math.max(Math.abs(a), Math.abs(b))));
        }
      });
      height[y * size + x] = h;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  const range = hi - lo || 1;
  const ramp = recipe.ramp.map((c) => [lin((c >> 16) & 255), lin((c >> 8) & 255), lin(c & 255)]);
  const colour = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const strength = recipe.normal ?? 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      // Heights are stored as float32 but lo/hi came from float64: clamp the rounding.
      const t = Math.min(1, Math.max(0, ((height[i] as number) - lo) / range));
      const f = t * (ramp.length - 1);
      const k = Math.min(ramp.length - 2, Math.floor(f));
      const a = ramp[k] as number[];
      const b = ramp[k + 1] as number[];
      const w = f - k;
      colour.set([srgb(a[0] + (b[0] - a[0]) * w), srgb(a[1] + (b[1] - a[1]) * w), srgb(a[2] + (b[2] - a[2]) * w), 255], i * 4);
      const r = recipe.roughness[0] + (recipe.roughness[1] - recipe.roughness[0]) * (1 - t);
      const rv = Math.round(Math.max(0, Math.min(1, r)) * 255);
      rough.set([255, rv, 0, 255], i * 4); // glTF ORM layout: occlusion, roughness, metalness
      const hx = ((height[y * size + ((x + 1) % size)] as number) - (height[y * size + ((x + size - 1) % size)] as number)) / range;
      const hy = ((height[((y + 1) % size) * size + x] as number) - (height[((y + size - 1) % size) * size + x] as number)) / range;
      const nx = -hx * strength * size * 0.02;
      const ny = -hy * strength * size * 0.02;
      const nl = Math.hypot(nx, ny, 1);
      normal.set([Math.round((nx / nl) * 127.5 + 127.5), Math.round((ny / nl) * 127.5 + 127.5), Math.round((1 / nl) * 127.5 + 127.5), 255], i * 4);
    }
  return { colour, rough, normal };
}

// ---- PNG encoding ----------------------------------------------------------------------------------
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (const b of bytes) c = (crcTable[(c ^ b) & 255] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
/** Encode RGBA8 pixels as a PNG file. */
export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const header = new Uint8Array(13);
  const dv = new DataView(header.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 6 }))),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
