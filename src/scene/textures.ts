import * as THREE from "three";

// PBR texture sets shipped in public/textures/<set>/ as WebP (see assets.manifest.json):
// colour in sRGB, everything else linear. ARM packs AO · roughness · metalness, Poly Haven style.
// Adapted from ODD TIDE's src/world/textures.ts (reused with permission).

export interface PbrSet {
  colour: THREE.Texture;
  normal: THREE.Texture;
  arm: THREE.Texture;
}

const loader = new THREE.TextureLoader();
const cache = new Map<string, Promise<THREE.Texture>>();
let anisotropy = 8;

export function setAnisotropy(a: number) {
  anisotropy = a;
}

export function loadTexture(url: string, colour: boolean): Promise<THREE.Texture> {
  const key = `${url}|${colour}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const promise = loader.loadAsync(`${import.meta.env.BASE_URL}${url}`).then((t) => {
    t.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
    t.name = url;
    return t;
  });
  cache.set(key, promise);
  return promise;
}

export async function loadPbrSet(name: string): Promise<PbrSet> {
  const base = `textures/${name}/${name}`;
  const [colour, normal, arm] = await Promise.all([
    loadTexture(`${base}_diff.webp`, true),
    loadTexture(`${base}_nor.webp`, false),
    loadTexture(`${base}_arm.webp`, false),
  ]);
  return { colour, normal, arm };
}

/** A set cloned with its own repeat, so one scan can serve surfaces at different scales. */
export function repeated(set: PbrSet, u: number, v = u): PbrSet {
  const r = (t: THREE.Texture) => {
    const c = t.clone();
    c.repeat.set(u, v);
    c.needsUpdate = true;
    return c;
  };
  return { colour: r(set.colour), normal: r(set.normal), arm: r(set.arm) };
}

/** Apply a set to a standard or physical material (ARM drives AO, roughness and metalness). */
export function applySet(m: THREE.MeshStandardMaterial, set: PbrSet, normalScale = 1) {
  m.map = set.colour;
  m.normalMap = set.normal;
  m.normalScale.setScalar(normalScale);
  m.aoMap = set.arm;
  m.roughnessMap = set.arm;
  m.metalnessMap = set.arm;
  m.needsUpdate = true;
  return m;
}
