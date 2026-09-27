import type { Recipes } from "./kit/build";
import {
  bend,
  blend,
  box,
  capsule,
  carve,
  chain,
  cone,
  cylinder,
  displace,
  ellipsoid,
  extrude,
  fbm,
  lathe,
  type Mat,
  mat,
  mirrorX,
  mottle,
  move,
  type Node,
  paint,
  polygon2,
  radial,
  rng,
  rotate,
  scale,
  sphere,
  subtract,
  torus,
  union,
  type Vec3,
} from "./kit/sdf";

const pick = <T>(r: () => number, list: T[]) => list[Math.floor(r() * list.length)] as T;
const range = (r: () => number, a: number, b: number) => a + (b - a) * r();
void [bend, blend, box, capsule, carve, chain, cone, cylinder, displace, ellipsoid, extrude, fbm, lathe, mirrorX, mottle, move, paint, polygon2, radial, rotate, scale, sphere, subtract, torus, union];
type Build = (seed: number, index: number) => Node;
void (0 as unknown as Mat | Vec3 | Build);

// BEARLY PREPARED — the bear (felt/clay proportion studies for choosing the character) and a
// camping prop kit for the packing and balance gags.
const FUR = [0x8a5a34, 0x6b4428, 0xb07d4a, 0x3a2a20, 0xc99a62];
const bear: Build = (seed) => {
  const r = rng(seed);
  const fur = mat(pick(r, FUR), 0.95);
  const muzzle = mat(0xe3c9a0, 0.9);
  const nose = mat(0x2a1f1a, 0.4);
  // Proportion studies pushed wide on purpose: head, belly, legs and ears all vary.
  const chub = range(r, 0.75, 1.6);
  const h = range(r, 0.7, 1.25);
  const body = move(ellipsoid(0.32 * chub, 0.38 * h, 0.27 * chub, fur), [0, 0.55 * h, 0]);
  const belly = move(ellipsoid(0.22 * chub, 0.26 * h, 0.1, muzzle), [0, 0.5 * h, 0.2 * chub]);
  const headY = 0.55 * h + 0.38 * h + range(r, 0.12, 0.2);
  const headR = range(r, 0.17, 0.34);
  const head = move(sphere(headR, fur), [0, headY, 0.02]);
  const snout = move(ellipsoid(headR * 0.45, headR * 0.35, headR * 0.5, muzzle), [0, headY - headR * 0.2, headR * 0.85]);
  const noseN = move(sphere(headR * 0.14, nose), [0, headY - headR * 0.08, headR * 1.3]);
  const earSize = range(r, 0.24, 0.42);
  const earTilt = range(r, 0.55, 0.9);
  const ears = mirrorX(move(sphere(headR * earSize, fur), [headR * earTilt, headY + headR * (1.25 - earTilt * 0.7), -0.02]));
  const eyes = mirrorX(move(sphere(headR * 0.07, nose), [headR * 0.38, headY + headR * 0.15, headR * 0.86]));
  const arms = mirrorX(capsule([0.26 * chub, 0.72 * h, 0.05], [0.36 * chub + range(r, 0, 0.1), 0.42 * h, 0.12], 0.08, 0.075, fur));
  const legs = mirrorX(capsule([0.14 * chub, 0.3 * h, 0.02], [0.17 * chub, 0.08, 0.08], 0.1, 0.1, fur));
  const feet = mirrorX(move(ellipsoid(0.1, 0.06, 0.14, fur), [0.17 * chub, 0.05, 0.12]));
  return mottle(union(blend(0.06, body, head, arms, legs, feet, ears, snout), belly, noseN, eyes), 0.06, 25, seed);
};

const PAINT = [0xc84b3c, 0x2f6f8a, 0xe8c547, 0x3f7a4f, 0xe8e0cc, 0x8a4f7a];
const enamel = (r: () => number) => mat(pick(r, PAINT), 0.35, 0.1);
const kettle = (r: () => number) => {
  const m = enamel(r);
  const body = lathe([[0, 0], [0.12, 0], [0.14, 0.08], [0.12, 0.16], [0.05, 0.19], [0, 0.2]], 0, m, true);
  const spout = capsule([0.1, 0.07, 0], [0.2, 0.16, 0], 0.025, 0.012, m);
  const handle = move(rotate(torus(0.08, 0.01, mat(0x2a2a2a, 0.5)), [0, 0, Math.PI / 2]), [0, 0.22, 0]);
  return union(body, spout, subtractBelow(handle, 0.19));
};
const subtractBelow = (n: Node, y0: number): Node => ({ d: (x, y, z) => Math.max(n.d(x, y, z), y0 - y), mat: n.mat, box: n.box });
const pot = (r: () => number) => {
  const m = enamel(r);
  const body = lathe([[0.13, 0.15], [0.13, 0], [0, 0]], 0.006, m);
  const handles = mirrorX(move(rotate(torus(0.03, 0.007, m), [Math.PI / 2, 0, 0]), [0.15, 0.12, 0]));
  return union(body, handles);
};
const mug = (r: () => number) => {
  const m = enamel(r);
  return union(lathe([[0.045, 0.1], [0.045, 0], [0, 0]], 0.004, m), move(rotate(torus(0.03, 0.006, m), [Math.PI / 2, 0, 0]), [0.055, 0.05, 0]));
};
const lantern = (r: () => number) => {
  const metal = mat(pick(r, [0x2f4a3a, 0x8a3a2a, 0x3a3a3a]), 0.4, 0.8);
  const glass = mat(0xffe2a8, 0.1);
  return union(move(cylinder(0.07, 0.02, 0.004, metal), [0, 0.01, 0]), move(cylinder(0.055, 0.14, 0.004, glass), [0, 0.09, 0]), radial(capsule([0.06, 0.02, 0], [0.06, 0.16, 0], 0.004, 0.004, metal), 4), move(cone(0.08, 0.02, 0.05, metal), [0, 0.19, 0]), move(rotate(torus(0.05, 0.005, metal), [Math.PI / 2, 0, 0]), [0, 0.25, 0]));
};
const backpack = (r: () => number) => {
  const cloth = mat(pick(r, [0xb5552e, 0x3f5f7a, 0x6a7a3a, 0xd9a441]), 0.9);
  const strap = mat(0x3a2a20, 0.8);
  const body = displace(box(0.34, 0.5, 0.22, 0.08, cloth), 0.008, 10, 3, 3);
  const pocket = move(box(0.26, 0.18, 0.08, 0.04, cloth), [0, -0.1, 0.12]);
  const straps = mirrorX(move(box(0.04, 0.44, 0.02, 0.008, strap), [0.09, 0, -0.12]));
  const roll = move(rotate(cylinder(0.07, 0.36, 0.03, mat(0x4a6a8a, 0.9)), [0, 0, Math.PI / 2]), [0, 0.3, 0]);
  return union(blend(0.02, body, pocket), straps, roll);
};
const logPile = (r: () => number) => {
  const bark = mat(0x5a4636, 0.95);
  const parts: Node[] = [];
  for (let i = 0; i < 3 + Math.floor(r() * 3); i++) parts.push(move(rotate(cylinder(range(r, 0.04, 0.07), range(r, 0.4, 0.6), 0.01, bark), [0, r() * 3, Math.PI / 2]), [0, 0.05 + i * 0.06, range(r, -0.1, 0.1)]));
  return displace(union(...parts), 0.004, 30, 2, 5);
};
const tent = (r: () => number) => {
  const cloth = mat(pick(r, [0xd9a441, 0x3f7a4f, 0xc84b3c, 0x3f5f7a]), 0.85);
  const w = range(r, 0.8, 1.2);
  const prism = { d: (x: number, y: number, z: number) => Math.max(Math.abs(z) - w * 0.7, (Math.abs(x) * 0.8 + y - w * 0.6) / 1.28, -y), mat: () => cloth, box: [-w, 0, -w * 0.7, w, w * 0.6, w * 0.7] as [number, number, number, number, number, number] };
  return subtract(prism, move(box(w * 0.3, w * 0.4, 0.2), [0, 0.1, w * 0.7]));
};
const axe = (r: () => number) => {
  const wood = mat(0x9a6a3a, 0.7);
  const head = mat(pick(r, [0xc84b3c, 0x5a5f66]), 0.4, 0.8);
  return union(capsule([0, 0, 0], [0, 0.5, 0], 0.016, 0.018, wood), move(box(0.12, 0.08, 0.025, 0.006, head), [0.04, 0.46, 0]));
};
const PROPS = [kettle, pot, mug, lantern, backpack, logPile, tent, axe];
const prop: Build = (seed, index) => PROPS[index % PROPS.length]?.(rng(seed)) as Node;

export const project = { id: "06-bearly-prepared", name: "BEARLY PREPARED", background: 0x3a3226 };
export const families: Recipes["families"] = [
  { id: "bear-study", count: 24, voxel: 0.008, keep: 0.25, hero: true, wear: 0.15, dirt: 0.4, build: bear },
  { id: "camp-prop", count: 48, voxel: 0.004, keep: 0.3, build: prop },
];
export const textures: Recipes["textures"] = [
  { id: "felt-fur", ramp: [0x5a3a22, 0x8a5a34, 0xa06a3e], layers: [{ kind: "fbm", scale: 96, octaves: 3 }, { kind: "fibres", scale: 128, stretch: 2, weight: 0.5 }], roughness: [0.9, 1], normal: 1.5 },
  { id: "painted-wood", ramp: [0x8a3a2a, 0xc84b3c, 0xd9644c], layers: [{ kind: "grain", rings: 16, warp: 1 }, { kind: "cells", count: 12, crack: true, weight: 0.3 }], roughness: [0.4, 0.7], normal: 0.8 },
  { id: "canvas", ramp: [0x8a7a4a, 0xb9a66a, 0xcfbd82], layers: [{ kind: "weave", count: 64 }, { kind: "fbm", scale: 8, weight: 0.4 }], roughness: [0.8, 0.95], normal: 1.4 },
  { id: "clay", ramp: [0x9a5a3a, 0xb8704a, 0xc98a60], layers: [{ kind: "fbm", scale: 24, octaves: 5 }], roughness: [0.6, 0.85], normal: 1 },
  { id: "enamel-speckle", ramp: [0x1f3d5a, 0x2f6f8a, 0xe8e0cc], layers: [{ kind: "cells", count: 90 }, { kind: "fbm", scale: 30, weight: 0.3 }], roughness: [0.25, 0.4], normal: 0.4 },
];
