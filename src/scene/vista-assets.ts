import * as THREE from "three";
import type { SceneAssets } from "./assets";
import type { HeightGrid } from "./land";

// The baked vista (tools/bake → public/vista/): eroded heights, the land's light, the trees that
// stand on it and the path-traced sky. Loaded once, before the ground is built, so every height
// the game asks for agrees with what is drawn.

export interface VistaInfo {
  version: number;
  grids: Record<
    "inner" | "outer",
    {
      x0: number;
      z0: number;
      size: number;
      light: number;
      height: { n: number; offset: number; scale: number };
    }
  >;
  lightScale: number;
  forest: { count: number; stride: number; tintScale: number };
  /** The flood-filled lake's bounds (m); its mask is lake.webp on the inner grid. */
  lake: { x: [number, number]; z: [number, number] };
  sky: {
    width: number;
    height: number;
    elTopDeg: number;
    elBottomDeg: number;
    scale: number;
    sunTransmittance: number;
    /** 256 × RGB: the sky just above the horizon, by azimuth (pre-exposed). */
    horizon: number[];
  };
}

export interface Forest {
  count: number;
  x: Float32Array;
  z: Float32Array;
  /** Height (m). */
  h: Float32Array;
  /** Light on each crown relative to open sunlit ground (RGB). */
  tint: Float32Array;
}

export interface VistaAssets {
  info: VistaInfo;
  inner: HeightGrid;
  outer: HeightGrid;
  innerLight: THREE.Texture;
  outerLight: THREE.Texture;
  innerMat: THREE.Texture;
  lakeMask: THREE.Texture;
  sky: THREE.Texture;
  /** The same sky, mipmapped, for the environment bake. */
  skyEnv: THREE.Texture;
  forest: Forest;
}

const BASE = `${import.meta.env.BASE_URL}vista/`;

/** Fetch a gzip file and inflate it (unless the server already did). */
async function inflate(url: string, assets?: SceneAssets): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal: assets?.signal });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const buf = await res.arrayBuffer();
  const head = new Uint8Array(buf, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buf;
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

async function heights(
  name: string,
  g: VistaInfo["grids"]["inner"],
  assets?: SceneAssets,
): Promise<HeightGrid> {
  const { n, offset, scale } = g.height;
  const deltas = new Uint16Array(await inflate(`${BASE}${name}-h.bin.gz`, assets));
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    let q = 0;
    for (let i = 0; i < n; i++) {
      q = (q + (deltas[j * n + i] as number)) & 0xffff;
      data[j * n + i] = q / scale - offset;
    }
  }
  return { x0: g.x0, z0: g.z0, size: g.size, n, data };
}

function texture(
  loader: THREE.TextureLoader,
  file: string,
  srgb: boolean,
  mips = true,
  assets?: SceneAssets,
) {
  const job = loader.loadAsync(`${BASE}${file}`).then((t) => {
    assets?.resources.retain(t);
    assets?.assertAlive();
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = mips;
    t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
  return assets ? assets.wait(job) : job;
}

async function forest(info: VistaInfo, assets?: SceneAssets): Promise<Forest> {
  const buf = await inflate(`${BASE}forest.bin.gz`, assets);
  const count = info.forest.count;
  const view = new DataView(buf);
  const f: Forest = {
    count,
    x: new Float32Array(count),
    z: new Float32Array(count),
    h: new Float32Array(count),
    tint: new Float32Array(count * 3),
  };
  const s = info.forest.stride;
  const k = info.forest.tintScale / 255;
  for (let i = 0; i < count; i++) {
    const o = i * s;
    f.x[i] = view.getFloat32(o, true);
    f.z[i] = view.getFloat32(o + 4, true);
    f.h[i] = view.getUint8(o + 8) / 5;
    f.tint[i * 3] = view.getUint8(o + 9) * k;
    f.tint[i * 3 + 1] = view.getUint8(o + 10) * k;
    f.tint[i * 3 + 2] = view.getUint8(o + 11) * k;
  }
  return f;
}

export async function loadVista(
  mobile: boolean,
  anisotropy: number,
  assets?: SceneAssets,
): Promise<VistaAssets> {
  const res = await fetch(`${BASE}vista.json`, { signal: assets?.signal });
  if (!res.ok) throw new Error(`vista.json: ${res.status}`);
  const info = (await res.json()) as VistaInfo;
  assets?.assertAlive();
  const loader = new THREE.TextureLoader();
  const lo = mobile ? "-lo" : "";
  const [inner, outer, innerLight, outerLight, innerMat, lakeMask, sky, skyEnv, trees] =
    await Promise.all([
      heights("inner", info.grids.inner, assets),
      heights("outer", info.grids.outer, assets),
      texture(loader, `inner-light${lo}.webp`, true, true, assets),
      texture(loader, `outer-light${lo}.webp`, true, true, assets),
      texture(loader, "inner-mat.webp", false, true, assets),
      texture(loader, "lake.webp", false, false, assets),
      texture(loader, `sky${lo}.webp`, true, false, assets),
      texture(loader, "sky-lo.webp", true, true, assets),
      forest(info, assets),
    ]);
  for (const t of [innerLight, outerLight, innerMat]) t.anisotropy = anisotropy;
  // The sky wraps around: repeat across the seam at north-east so filtering is seamless.
  sky.wrapS = THREE.RepeatWrapping;
  skyEnv.wrapS = THREE.RepeatWrapping;
  return {
    info,
    inner,
    outer,
    innerLight,
    outerLight,
    innerMat,
    lakeMask,
    sky,
    skyEnv,
    forest: trees,
  };
}
