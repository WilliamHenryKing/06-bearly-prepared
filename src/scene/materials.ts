import * as THREE from "three";
import { type PbrSet, repeated } from "./textures";

// Tactile materials, painted procedurally into small canvases: felt, painted wood, canvas
// weave, speckled enamel. Everything shares one warm palette.

export const PALETTE = {
  fur: 0x9a6438,
  furDark: 0x6e4527,
  muzzle: 0xe8d2ac,
  nose: 0x2a1f1a,
  enamelRed: 0xc84b3c,
  enamelBlue: 0x2f6f8a,
  cream: 0xefe4c8,
  mustard: 0xd9a441,
  moss: 0x5f7a3a,
  grass: 0x7d9a45,
  dirt: 0xb48a5c,
  rock: 0x8f887c,
  wood: 0xa8703f,
  bark: 0x5a4636,
  pine: 0x3f6a45,
  sky: 0xc9dde0,
} as const;

function canvas(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (g) draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Deterministic hash so the look is stable across reloads.
let seed = 7;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

/** Grey fibre noise used as a bump map on felt and canvas. */
export const fibreBump = canvas(256, (g, s) => {
  g.fillStyle = "#808080";
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 2600; i++) {
    const x = rand() * s;
    const y = rand() * s;
    const a = rand() * Math.PI;
    const l = 3 + rand() * 7;
    const v = Math.floor(90 + rand() * 90);
    g.strokeStyle = `rgba(${v},${v},${v},0.55)`;
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
});

const grain = canvas(256, (g, s) => {
  g.fillStyle = "#fff";
  g.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 2) {
    const v = 225 + Math.sin(y * 0.21 + Math.sin(y * 0.05) * 3) * 18 + rand() * 10;
    g.fillStyle = `rgb(${v},${v - 6},${v - 14})`;
    g.fillRect(0, y, s, 2);
  }
  for (let i = 0; i < 60; i++) {
    g.fillStyle = "rgba(90,60,30,0.08)";
    g.fillRect(rand() * s, rand() * s, 20 + rand() * 60, 1);
  }
});

const tartan = canvas(128, (g, s) => {
  g.fillStyle = "#b5423a";
  g.fillRect(0, 0, s, s);
  g.globalAlpha = 0.55;
  for (const [c, w, o] of [
    ["#2f4f6a", 22, 10],
    ["#2f4f6a", 22, 74],
    ["#e8c547", 4, 50],
    ["#1d2a24", 8, 100],
  ] as const) {
    g.fillStyle = c;
    g.fillRect(o, 0, w, s);
    g.fillRect(0, o, s, w);
  }
});

const speckle = canvas(128, (g, s) => {
  g.fillStyle = "#fff";
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = rand() > 0.5 ? "rgba(40,30,30,0.35)" : "rgba(255,255,255,0.6)";
    g.fillRect(rand() * s, rand() * s, 1 + rand() * 1.5, 1 + rand() * 1.5);
  }
});
export const sharedTextures = [fibreBump, grain, tartan, speckle];

// Scanned detail maps (see assets.manifest.json) arrive after load; materials made before then
// are upgraded in place, and anything made later picks them up directly.
type Kind = "felt" | "wood" | "cloth" | "bark";
export interface DetailSets {
  felt: PbrSet;
  wood: PbrSet;
  cloth: PbrSet;
  bark: PbrSet;
}
const registry: { kind: Kind; m: THREE.MeshStandardMaterial }[] = [];
let detail: DetailSets | null = null;
const REPEAT: Record<Kind, number> = { felt: 5, wood: 1, cloth: 6, bark: 1 };
const NORMAL: Record<Kind, number> = { felt: 0.7, wood: 0.8, cloth: 0.9, bark: 1 };

function upgrade(kind: Kind, m: THREE.MeshStandardMaterial) {
  if (!detail) return;
  const set = repeated(detail[kind], REPEAT[kind]);
  m.normalMap = set.normal;
  m.normalScale.setScalar(NORMAL[kind]);
  m.aoMap = set.arm;
  if (kind === "bark") m.map = set.colour;
  if (kind !== "wood") m.roughnessMap = set.arm;
  m.bumpMap = null;
  m.needsUpdate = true;
}

function register<T extends THREE.MeshStandardMaterial>(kind: Kind, m: T): T {
  const entry = { kind, m };
  registry.push(entry);
  m.addEventListener("dispose", () => {
    if (m.userData.keepDetail) return;
    const i = registry.indexOf(entry);
    if (i >= 0) registry.splice(i, 1);
  });
  upgrade(kind, m);
  return m;
}

export function provideDetail(sets: DetailSets) {
  detail = sets;
  for (const r of registry) upgrade(r.kind, r.m);
}

export function felt(color: number, sheen = 0.8) {
  return register(
    "felt",
    new THREE.MeshPhysicalMaterial({
      color,
      roughness: 1,
      sheen,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xfff3dc), 0.55),
      bumpMap: fibreBump,
      bumpScale: 1.4,
    }),
  );
}

export function paintedWood(color: number) {
  return register(
    "wood",
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.62,
      map: grain,
      bumpMap: grain,
      bumpScale: 0.6,
    }),
  );
}

export function bark() {
  return register("bark", new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }));
}

export function enamel(color: number) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    map: speckle,
  });
}

export function ceramic(color: number) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.25,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
}

/** Brushed brass: metallic, with anisotropic highlights along the brushing. */
export function brass() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xd9ad5b,
    metalness: 1,
    roughness: 0.3,
    anisotropy: 0.7,
  });
}

export function tartanCloth() {
  const t = tartan.clone();
  t.needsUpdate = true;
  return register(
    "cloth",
    new THREE.MeshPhysicalMaterial({
      map: t,
      roughness: 0.95,
      sheen: 0.6,
      sheenColor: new THREE.Color(0xffe0c0),
      bumpMap: fibreBump,
      bumpScale: 1.2,
    }),
  );
}

export function canvasCloth(color: number) {
  return register("cloth", new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
}

export const matte = (color: number, roughness = 0.9) =>
  new THREE.MeshStandardMaterial({ color, roughness });

export const tartanTexture = tartan;
