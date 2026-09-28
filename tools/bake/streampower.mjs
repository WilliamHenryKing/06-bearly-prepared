// Landscape bake, stage A1 (CPU): the designed land (src/scene/land.ts) → fluvially eroded
// heightfields.
//
// Tectonic uplift against stream-power incision (dh/dt = U − K·A^m·S), after Cordonnier et al.
// (2016), "Large Scale Terrain Generation from Tectonic Uplift and Fluvial Erosion": an authored,
// smooth uplift field says where the ranges stand (highest behind the lake), and the drainage
// network the rivers cut into it makes the valleys, ridges, peaks and cols. Solved with the
// implicit O(n) scheme of Braun & Willett (2013), routing over a Priority-Flood + ε surface
// (Barnes, Lehman & Mulla 2014) so every cell drains to base level: the domain's edge and the
// lake. Closed hollows slowly fill with sediment, which gives flat valley floors. Two grids:
//   outer — the whole horizon, 16.4 km at 8 m;
//   inner — the 4 km around the lookout, the valley and the lake, at 2 m, fed by the outer
//           grid's valleys and held to it at its edge.
// The trail's plateau is never eroded: the game's own ground and the bake must agree there.
//
// Run: bun tools/bake/streampower.mjs [--quick] [--iters=N]
// Writes float32 grids and previews to bake/work/ for stage A2 (tools/bake/erode_gpu.py).

import { mkdirSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { fbm, LAKE, landHeight, PLATEAU, valleyness } from "../../src/scene/land.ts";
import { sunAt } from "../../src/scene/render/sky-model.ts";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"];
  }),
);
const QUICK = !!args.quick;
const OUT = args.out ?? "bake/work";
mkdirSync(OUT, { recursive: true });

export const DOMAINS = {
  outer: { cx: -40, cz: 20, size: 16384, n: QUICK ? 512 : 2048 },
  inner: { cx: -600, cz: 400, size: 4096, n: QUICK ? 512 : 2048 },
};

/**
 * Stream power: area exponent, erodibility (per iteration), sediment infill of hollows, hillslope
 * creep, and the peak uplift per iteration (metres).
 */
const M = Number(args.m ?? 0.5);
const K = Number(args.k ?? 0.006);
const FILL = Number(args.fill ?? 0.05);
const DIFFUSE = Number(args.diffuse ?? 0.02);
const DIFFUSE_INNER = Number(args.diffuseInner ?? 0.08);
const U0 = Number(args.u ?? 1.7);
/** White-noise roughening (metres) every ten iterations: breaks D8's straight parallel rills. */
const ROUGH = Number(args.rough ?? 0.15);

const log = (...a) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(" ")}`;
  console.log(line);
};

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function cellX(d, i) {
  return d.cx - d.size / 2 + (i + 0.5) * (d.size / d.n);
}
function cellZ(d, j) {
  return d.cz - d.size / 2 + (j + 0.5) * (d.size / d.n);
}

const lakeE = (x, z) => Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);

// Smooth gradient noise (Perlin 2002 fade, hashed gradients): no grid-aligned blocks, unlike the
// value noise the runtime uses for small ground detail.
const perm = new Uint8Array(512);
{
  let seed = 90127;
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const GX = Array.from({ length: 16 }, (_, i) => Math.cos((i / 16) * Math.PI * 2 + 0.3));
const GZ = Array.from({ length: 16 }, (_, i) => Math.sin((i / 16) * Math.PI * 2 + 0.3));
function gnoise(x, z) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const g = (i, j, dx, dz) => {
    const h = perm[(perm[i & 255] + j) & 511] & 15;
    return GX[h] * dx + GZ[h] * dz;
  };
  const a = g(xi, zi, fx, fz);
  const b = g(xi + 1, zi, fx - 1, fz);
  const c = g(xi, zi + 1, fx, fz - 1);
  const d = g(xi + 1, zi + 1, fx - 1, fz - 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.4;
}
/** Gradient fbm with each octave rotated, so no direction is preferred. */
function gfbm(x, z, octaves) {
  let sum = 0;
  let amp = 0.5;
  for (let i = 0; i < octaves; i++) {
    sum += amp * gnoise(x + i * 19.1, z - i * 7.7);
    const nx = 1.6 * x - 1.2 * z;
    z = 1.2 * x + 1.6 * z;
    x = nx;
    amp *= 0.5;
  }
  return sum;
}

/**
 * Erodibility 0 … 1: nothing on the trail's plateau; full strength beyond a ragged rim, which
 * toward the valley sits at the scarp below the lookout.
 */
function erodibility(x, z) {
  const r = Math.hypot(x - PLATEAU.x, z - PLATEAU.z);
  const v = valleyness(x, z);
  const w = gfbm(x / 160, z / 160, 2) * (1 - v);
  return smooth(PLATEAU.r - 8 + 20 * (1 - v) + 30 * w, PLATEAU.r + 36 + 70 * (1 - v) + 50 * w, r);
}

/**
 * Where the crust rises (metres per iteration at 1): nothing on the plateau or down the valley to
 * the lake; forested knolls around the plateau; the ranges from about 1.5 km, starting later and
 * standing higher beyond the lake.
 */
function uplift(x, z) {
  const r = Math.hypot(x - PLATEAU.x, z - PLATEAU.z);
  const v = valleyness(x, z);
  const broad = gfbm(x / 5200, z / 5200, 2);
  const mid = gfbm(x / 1700 + 3.1, z / 1700 - 8.4, 3);
  // A ragged front, so the ranges do not ring the basin like a crater wall.
  const start = 1400 + 1100 * v + 520 * gfbm(x / 2300 - 5.2, z / 2300 + 1.7, 2);
  const ranges =
    smooth(start, start + 1900, r) *
    (0.72 + 0.45 * v) *
    Math.max(0.08, 0.72 + 1.0 * broad + 0.4 * mid);
  const knolls =
    smooth(PLATEAU.r + 70 + 60 * gfbm(x / 200, z / 200, 2), 650, r) *
    (1 - smooth(0.2, 0.55, v)) *
    0.16 *
    Math.max(0, 0.75 + 0.8 * mid);
  return Math.max(0, ranges + knolls);
}

/**
 * The starting surface before any uplift: the designed plateau, its scarp, the valley floor and
 * the lake (from land.ts), low rolling ground elsewhere, and a little roughness for the first
 * rivers to find.
 */
function baseHeight(x, z) {
  const r = Math.hypot(x - PLATEAU.x, z - PLATEAU.z);
  const design = landHeight(x, z);
  const v = valleyness(x, z);
  const floor = LAKE.level - 8 + fbm(x / 300, z / 300, 3) * 14;
  const low = 10 + gfbm(x / 900, z / 900, 3) * 18;
  const around = floor * v + low * (1 - v);
  const keep = 1 - smooth(PLATEAU.r + 10, PLATEAU.r + 150, r);
  let h = design * keep + Math.min(design, around) * (1 - keep);
  const lake = lakeE(x, z);
  if (lake < 1.6) h = Math.min(h, LAKE.level + (lake - 1) * 22 + 0.6);
  return h + gnoise(x / 60, z / 60) * 0.8 * (1 - keep);
}

// ---- Priority-Flood + ε with a binary min-heap -------------------------------------------

class Heap {
  constructor(cap) {
    this.idx = new Int32Array(cap);
    this.key = new Float64Array(cap);
    this.size = 0;
  }
  push(i, k) {
    let p = this.size++;
    const { idx, key } = this;
    while (p > 0) {
      const q = (p - 1) >> 1;
      if (key[q] <= k) break;
      idx[p] = idx[q];
      key[p] = key[q];
      p = q;
    }
    idx[p] = i;
    key[p] = k;
  }
  pop() {
    const { idx, key } = this;
    const top = idx[0];
    const n = --this.size;
    if (n > 0) {
      const li = idx[n];
      const lk = key[n];
      let p = 0;
      for (;;) {
        let c = 2 * p + 1;
        if (c >= n) break;
        if (c + 1 < n && key[c + 1] < key[c]) c++;
        if (key[c] >= lk) break;
        idx[p] = idx[c];
        key[p] = key[c];
        p = c;
      }
      idx[p] = li;
      key[p] = lk;
    }
    return top;
  }
}

const DI = [-1, 0, 1, -1, 1, -1, 0, 1];
const DJ = [-1, -1, -1, 0, 0, 1, 1, 1];

/**
 * One routing pass: fills hollows (filled), orders cells from base level upward (order), and
 * points each at its steepest-descent receiver on the filled surface (rec, dist).
 */
function route(g, st) {
  const { n, dx } = g;
  const N = n * n;
  const { h, filled, order, rec, dist, outlet, seen, heap } = st;
  seen.fill(0);
  heap.size = 0;
  for (let c = 0; c < N; c++) {
    if (outlet[c]) {
      filled[c] = h[c];
      seen[c] = 1;
      heap.push(c, h[c]);
    }
  }
  const eps = 1e-4 * dx;
  let k = 0;
  while (heap.size > 0) {
    const c = heap.pop();
    order[k++] = c;
    const i = c % n;
    const j = (c / n) | 0;
    const fc = filled[c];
    for (let q = 0; q < 8; q++) {
      const ii = i + DI[q];
      const jj = j + DJ[q];
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const nb = jj * n + ii;
      if (seen[nb]) continue;
      seen[nb] = 1;
      const f = Math.max(h[nb], fc + eps);
      filled[nb] = f;
      heap.push(nb, f);
    }
  }
  const diag = dx * Math.SQRT2;
  for (let c = 0; c < N; c++) {
    if (outlet[c]) {
      rec[c] = c;
      dist[c] = dx;
      continue;
    }
    const i = c % n;
    const j = (c / n) | 0;
    const fc = filled[c];
    let best = -1;
    let bestS = 0;
    let bestD = dx;
    for (let q = 0; q < 8; q++) {
      const ii = i + DI[q];
      const jj = j + DJ[q];
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const nb = jj * n + ii;
      const d = DI[q] !== 0 && DJ[q] !== 0 ? diag : dx;
      const s = (fc - filled[nb]) / d;
      if (s > bestS) {
        bestS = s;
        best = nb;
        bestD = d;
      }
    }
    rec[c] = best < 0 ? c : best;
    dist[c] = bestD;
  }
}

function accumulate(g, st) {
  const N = g.n * g.n;
  const { order, rec, area } = st;
  area.fill(g.dx * g.dx);
  for (let k = N - 1; k >= 0; k--) {
    const c = order[k];
    const r = rec[c];
    if (r !== c) area[r] += area[c];
  }
}

function incise(g, st) {
  const N = g.n * g.n;
  const { order, rec, dist, area, h, filled, erod, up } = st;
  for (let k = 0; k < N; k++) {
    const c = order[k];
    const r = rec[c];
    const e = erod[c];
    if (r === c || e === 0) continue;
    const hc = h[c] + up[c];
    const hr = h[r];
    if (hc > hr) {
      const F = (K * e * area[c] ** M) / dist[c];
      h[c] = (hc + F * hr) / (1 + F);
    } else {
      // A hollow on the way to base level: sediment settles in it until it spills.
      h[c] = Math.min(Math.max(filled[c], hc), hc + FILL * e);
    }
  }
}

/** Hillslope creep: a light linear diffusion that rounds knife-edges between the channels. */
function diffuse(g, st, rate) {
  const { n } = g;
  const { h, erod, tmp } = st;
  tmp.set(h);
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const c = j * n + i;
      const e = erod[c];
      if (e === 0) continue;
      const lap = tmp[c - 1] + tmp[c + 1] + tmp[c - n] + tmp[c + n] - 4 * tmp[c];
      h[c] = tmp[c] + rate * e * lap;
    }
  }
}

function makeState(g) {
  const N = g.n * g.n;
  return {
    h: new Float64Array(N),
    h0: new Float64Array(N),
    filled: new Float64Array(N),
    tmp: new Float64Array(N),
    order: new Int32Array(N),
    rec: new Int32Array(N),
    dist: new Float64Array(N),
    area: new Float64Array(N),
    outlet: new Uint8Array(N),
    seen: new Uint8Array(N),
    erod: new Float64Array(N),
    up: new Float64Array(N),
    heap: new Heap(N),
  };
}

function erode(name, g, st, iters, creep) {
  const t0 = Date.now();
  let seed = 7919;
  const N = g.n * g.n;
  for (let it = 1; it <= iters; it++) {
    route(g, st);
    accumulate(g, st);
    incise(g, st);
    if (creep > 0) diffuse(g, st, creep);
    if (ROUGH > 0 && it % 10 === 0 && it < iters - 5) {
      for (let c = 0; c < N; c++) {
        seed = (seed * 16807) % 2147483647;
        st.h[c] += (seed / 2147483647 - 0.5) * ROUGH * st.erod[c];
      }
    }
    if (it % 25 === 0 || it === iters) {
      const s = (Date.now() - t0) / 1000;
      log(`${name}: ${it}/${iters} iterations, ${s.toFixed(0)} s (${(s / it).toFixed(2)} s each)`);
    }
  }
  // The routing of the final surface, for rivers.
  route(g, st);
  accumulate(g, st);
}

// ---- Output ---------------------------------------------------------------------------------

function writeF32(path, arr) {
  const f = arr instanceof Float32Array ? arr : Float32Array.from(arr);
  writeFileSync(path, Buffer.from(f.buffer, f.byteOffset, f.byteLength));
}

function png(path, w, h, rgb) {
  const row = w * 3 + 1;
  const raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) {
    raw[y * row] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * row + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw, { level: 6 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const SUN = (() => {
  const d = sunAt(17.4).direction;
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
})();

/** Hillshade under the game's sun, tinted by height, with rivers in blue. */
function preview(path, g, h, area, size = 1024) {
  const { n, dx } = g;
  const step = n / size;
  const rgb = new Uint8Array(size * size * 3);
  const at = (i, j) => h[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = Math.floor(x * step);
      const j = Math.floor(y * step);
      const s = Math.max(1, Math.round(step));
      const gx = (at(i + s, j) - at(i - s, j)) / (2 * s * dx);
      const gz = (at(i, j + s) - at(i, j - s)) / (2 * s * dx);
      const nl = Math.hypot(gx, 1, gz);
      const lit = Math.max(0, (-gx * SUN[0] + SUN[1] - gz * SUN[2]) / nl);
      const sky = 1 / nl;
      const shade = 0.25 * sky + 0.95 * lit;
      const v = at(i, j);
      // Hypsometric tint: valley green → alpine brown → snow.
      let r;
      let gg;
      let b;
      if (v < LAKE.level + 0.3 && lakeE(cellX(g, i), cellZ(g, j)) < 1.05) {
        r = 0.25;
        gg = 0.4;
        b = 0.55;
      } else if (v < 250) {
        const t = Math.max(0, (v + 60) / 310);
        r = 0.36 + 0.25 * t;
        gg = 0.5 + 0.08 * t;
        b = 0.28 + 0.1 * t;
      } else if (v < 650) {
        const t = (v - 250) / 400;
        r = 0.61 + 0.1 * t;
        gg = 0.58 - 0.06 * t;
        b = 0.38 + 0.1 * t;
      } else {
        const t = Math.min(1, (v - 650) / 200);
        r = 0.71 + 0.25 * t;
        gg = 0.52 + 0.43 * t;
        b = 0.48 + 0.49 * t;
      }
      const o = (y * size + x) * 3;
      let R = r * shade;
      let G = gg * shade;
      let B = b * shade;
      if (area) {
        const a = area[j * n + i];
        const river = smooth(5e5, 3e6, a);
        R += (0.18 - R) * river;
        G += (0.36 - G) * river;
        B += (0.7 - B) * river;
      }
      rgb[o] = Math.min(255, 255 * Math.sqrt(Math.max(0, R)));
      rgb[o + 1] = Math.min(255, 255 * Math.sqrt(Math.max(0, G)));
      rgb[o + 2] = Math.min(255, 255 * Math.sqrt(Math.max(0, B)));
    }
  }
  png(path, size, size, rgb);
}

// ---- Stages ---------------------------------------------------------------------------------

function initial(g, st, lowerBound = null) {
  const { n } = g;
  for (let j = 0; j < n; j++) {
    const z = cellZ(g, j);
    for (let i = 0; i < n; i++) {
      const x = cellX(g, i);
      const c = j * n + i;
      const h = lowerBound ? landHeight(x, z) : baseHeight(x, z);
      st.h0[c] = h;
      st.h[c] = h;
      st.erod[c] = erodibility(x, z);
      st.up[c] = lowerBound ? 0 : U0 * uplift(x, z) * st.erod[c];
      const edge = i === 0 || j === 0 || i === n - 1 || j === n - 1;
      const inLake = lakeE(x, z) < 0.97 && h < LAKE.level;
      st.outlet[c] = edge || inLake ? 1 : 0;
      if (inLake) st.erod[c] = 0;
    }
  }
  if (lowerBound) lowerBound(st);
}

function bicubic(src, g, x, z) {
  const { n } = g;
  const fx = (x - (g.cx - g.size / 2)) / g.dx - 0.5;
  const fz = (z - (g.cz - g.size / 2)) / g.dx - 0.5;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const w = (t) => [
    ((-0.5 * t + 1) * t - 0.5) * t,
    (1.5 * t - 2.5) * t * t + 1,
    ((-1.5 * t + 2) * t + 0.5) * t,
    (0.5 * t - 0.5) * t * t,
  ];
  const wx = w(tx);
  const wz = w(tz);
  let s = 0;
  for (let b = 0; b < 4; b++) {
    const jj = Math.min(n - 1, Math.max(0, j - 1 + b));
    let r = 0;
    for (let a = 0; a < 4; a++) {
      const ii = Math.min(n - 1, Math.max(0, i - 1 + a));
      r += wx[a] * src[jj * n + ii];
    }
    s += wz[b] * r;
  }
  return s;
}

const t0 = Date.now();
const outerIters = Number(args.iters ?? (QUICK ? 120 : 300));
const innerIters = Number(args.innerIters ?? (QUICK ? 60 : 160));
const meta = {
  created: new Date().toISOString(),
  m: M,
  k: K,
  fill: FILL,
  diffuse: DIFFUSE,
  diffuseInner: DIFFUSE_INNER,
  uplift: U0,
  rough: ROUGH,
  domains: {},
};

// Outer: the whole horizon.
{
  const d = DOMAINS.outer;
  const g = { ...d, dx: d.size / d.n };
  log(`outer ${g.n}² at ${g.dx} m: sampling the designed land`);
  const st = makeState(g);
  initial(g, st);
  writeF32(`${OUT}/outer_h0.f32`, st.h0);
  preview(`${OUT}/outer_h0.png`, g, st.h0, null);
  erode("outer", g, st, outerIters, DIFFUSE);
  writeF32(`${OUT}/outer_h.f32`, st.h);
  writeF32(`${OUT}/outer_area.f32`, st.area);
  writeF32(`${OUT}/outer_erod.f32`, st.erod);
  preview(`${OUT}/outer_h.png`, g, st.h, st.area);
  meta.domains.outer = { ...d, dx: g.dx, iters: outerIters };
  globalThis.outer = { g, h: Float64Array.from(st.h), h0: Float64Array.from(st.h0) };
}

// Inner: the valley at 2 m, carrying the outer grid's carving plus the design's fine detail.
{
  const d = DOMAINS.inner;
  const g = { ...d, dx: d.size / d.n };
  const o = globalThis.outer;
  log(`inner ${g.n}² at ${g.dx} m: sampling the designed land + the outer erosion`);
  const st = makeState(g);
  initial(g, st, (st) => {
    const { n } = g;
    for (let j = 0; j < n; j++) {
      const z = cellZ(g, j);
      for (let i = 0; i < n; i++) {
        const x = cellX(g, i);
        const c = j * n + i;
        // Off the plateau the eroded outer surface replaces the design, with a little of the
        // design's fine relief (finer than the outer grid can hold) laid back on top.
        const e = st.erod[c];
        const fine = st.h[c] - bicubic(o.h0, o.g, x, z);
        const outer = bicubic(o.h, o.g, x, z);
        st.h[c] = st.h[c] * (1 - e) + (outer + fine * 0.35) * e;
        st.h0[c] = st.h[c];
      }
    }
  });
  erode("inner", g, st, innerIters, DIFFUSE_INNER);
  writeF32(`${OUT}/inner_h.f32`, st.h);
  writeF32(`${OUT}/inner_area.f32`, st.area);
  writeF32(`${OUT}/inner_erod.f32`, st.erod);
  writeF32(`${OUT}/inner_h0.f32`, st.h0);
  preview(`${OUT}/inner_h.png`, g, st.h, st.area);
  meta.domains.inner = { ...d, dx: g.dx, iters: innerIters };
}

meta.seconds = Math.round((Date.now() - t0) / 1000);
meta.sun = SUN;
writeFileSync(`${OUT}/streampower.json`, JSON.stringify(meta, null, 2));
log(`done in ${meta.seconds} s`);
