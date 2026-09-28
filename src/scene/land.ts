// The land beyond the trail, as one height function everything samples, so the ground near the
// path, the far ring out to the horizon, the forests and the lake all agree. Once the baked land
// (tools/bake: tectonic uplift, river and droplet erosion) has loaded, landHeight() reads it; the
// analytic design below is what the bake grew from, and it stands in until then.
// The design:
// - a meadow plateau carries the trail;
// - west-south-west of the lookout it breaks into a steep scarp above a glacial valley with a
//   lake on its floor;
// - elsewhere it rolls up into forested ridges;
// - snow-capped ranges ring the horizon, highest behind the lake.
// Metres; +X east, -Z north.

/** Centre of the trail's plateau. */
export const PLATEAU = { x: -40, z: 20, r: 112 };
/** The valley opens from the plateau's edge toward this bearing (radians, atan2(z, x)). */
export const VALLEY_BEARING = Math.atan2(0.62, -0.78);
export const LAKE = { x: -470, z: 330, rx: 260, rz: 150, level: -54 };

const hash2 = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
function noise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
export function fbm(x: number, y: number, octaves: number) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * f + i * 17.3, y * f - i * 9.1);
    amp *= 0.5;
    f *= 2.02;
  }
  return sum;
}
/** Sharp-crested ridges (1 − |noise|, squared), for mountains. */
function ridged(x: number, y: number, octaves: number) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let weight = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise(x * f + i * 31.7, y * f + i * 11.3));
    n = n * n * weight;
    weight = Math.min(1, n * 1.8);
    sum += n * amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return sum;
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How much a point lies in the valley's direction from the plateau, 0 … 1. */
export function valleyness(x: number, z: number) {
  const a = Math.atan2(z - PLATEAU.z, x - PLATEAU.x);
  let d = a - VALLEY_BEARING;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return Math.exp(-((d / 0.62) ** 2));
}

/** A baked height grid: n × n cells covering [x0, x0 + size] × [z0, z0 + size]. */
export interface HeightGrid {
  x0: number;
  z0: number;
  size: number;
  n: number;
  data: Float32Array;
}

let inner: HeightGrid | null = null;
let outer: HeightGrid | null = null;

/** Use the baked land from now on (the fine grid around the valley, the coarse one to the horizon). */
export function setBakedLand(fine: HeightGrid, coarse: HeightGrid) {
  inner = fine;
  outer = coarse;
}

export const hasBakedLand = () => inner !== null;

const cubic = (a: number, b: number, c: number, d: number, t: number) =>
  b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));

/** Grid-space coordinates, or null outside the grid (with a one-cell margin). */
function cell(g: HeightGrid, x: number, z: number) {
  const u = ((x - g.x0) / g.size) * g.n - 0.5;
  const v = ((z - g.z0) / g.size) * g.n - 0.5;
  if (u < 1 || v < 1 || u > g.n - 3 || v > g.n - 3) return null;
  return [u, v] as const;
}

function bilinear(g: HeightGrid, u: number, v: number) {
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const d = g.data;
  const k = j * g.n + i;
  const a = (d[k] as number) + ((d[k + 1] as number) - (d[k] as number)) * fu;
  const b = (d[k + g.n] as number) + ((d[k + g.n + 1] as number) - (d[k + g.n] as number)) * fu;
  return a + (b - a) * fv;
}

function bicubic(g: HeightGrid, u: number, v: number) {
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const d = g.data;
  const row = (jj: number) => {
    const k = jj * g.n + i;
    return cubic(d[k - 1] as number, d[k] as number, d[k + 1] as number, d[k + 2] as number, fu);
  };
  return cubic(row(j - 1), row(j), row(j + 1), row(j + 2), fv);
}

/** The baked land at a point (smooth: bicubic on the fine grid), or null beyond both grids. */
function baked(x: number, z: number, smoothly: boolean): number | null {
  if (!inner || !outer) return null;
  const co = cell(outer, x, z);
  const ho = co ? bilinear(outer, co[0], co[1]) : null;
  const ci = cell(inner, x, z);
  if (!ci) return ho;
  const hi = smoothly ? bicubic(inner, ci[0], ci[1]) : bilinear(inner, ci[0], ci[1]);
  if (ho === null) return hi;
  // Hand over to the coarse grid across the fine grid's outermost 150 m.
  const edge =
    Math.min(ci[0], ci[1], inner.n - 3 - ci[0], inner.n - 3 - ci[1]) * (inner.size / inner.n);
  return ho + (hi - ho) * smooth(0, 150, edge);
}

/** Height of the land (not the carved trail corridor), metres. */
export function landHeight(x: number, z: number) {
  return baked(x, z, true) ?? designHeight(x, z);
}

/** The same land, bilinear only: for the tens of thousands of far-ring vertices. */
export function landHeightFast(x: number, z: number) {
  return baked(x, z, false) ?? designHeight(x, z);
}

/** The analytic design the bake grew from. */
export function designHeight(x: number, z: number) {
  const r = Math.hypot(x - PLATEAU.x, z - PLATEAU.z);
  const v = valleyness(x, z);
  // The plateau: gentle swells at about the trail's own height.
  const plateau = 3.2 + fbm(x / 55, z / 55, 3) * 2.4 + fbm(x / 13, z / 13, 2) * 0.5;
  // Beyond it: the valley side falls away down a scarp; elsewhere ridges rise.
  const out = smooth(PLATEAU.r - 10, PLATEAU.r + 130, r);
  const valleyFloor = LAKE.level - 8 + fbm(x / 300, z / 300, 3) * 14;
  const ridge = 28 + fbm(x / 160, z / 160, 4) * 45 + Math.max(0, r - 400) * 0.06;
  let h = plateau + out * ((valleyFloor - plateau) * v + (ridge - plateau) * (1 - v));
  // The scarp's face: a steep drop just past the plateau's edge in the valley direction.
  h -= v * smooth(PLATEAU.r - 4, PLATEAU.r + 30, r) * (1 - out) * 18;
  // The lake's basin, below its water line.
  const lake = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
  if (lake < 1.6) h = Math.min(h, LAKE.level + (lake - 1) * 22 + 0.6);
  // The ranges: snow peaks from about 1.6 km, highest beyond the lake.
  const far = smooth(900, 2600, r);
  if (far > 0) {
    const tall = 620 + 780 * v + 260 * fbm(x / 2600, z / 2600, 2);
    h += far * tall * ridged(x / 1500, z / 1500, 6) * (0.75 + 0.5 * smooth(1800, 4200, r));
  }
  // Rolling foothills and forested knolls between.
  h += smooth(200, 700, r) * (1 - far) * ridged(x / 420, z / 420, 4) * 70 * (1 - 0.6 * v);
  return h;
}

/** Density of forest at a point, 0 … 1 (none on the lake, on rock, above the tree line). */
export function forestDensity(x: number, z: number, height: number, slope: number) {
  const r = Math.hypot(x - PLATEAU.x, z - PLATEAU.z);
  if (r < 70 || height > 330 || height < LAKE.level + 0.8 || slope > 0.85) return 0;
  const patches = smooth(-0.1, 0.35, fbm(x / 140, z / 140, 3) + 0.1);
  const altitude = 1 - smooth(220, 330, height);
  return patches * altitude * smooth(70, 140, r);
}
