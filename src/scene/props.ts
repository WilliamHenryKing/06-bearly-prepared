import * as THREE from "three";
import type { ItemId } from "../game/items";
import {
  brass,
  ceramic,
  enamel,
  felt,
  matte,
  PALETTE,
  paintedWood,
  tartanCloth,
} from "./materials";

// The camping prop set. Each builder returns a group whose origin is the bottom centre and
// whose height matches the rules' item height, so the drawn stack is the simulated stack.

const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

/** Lay a ring flat (tori are built upright). */
const flat = (m: THREE.Mesh) => {
  m.rotation.x = Math.PI / 2;
  return m;
};

const lathe = (pts: [number, number][], segs = 28) =>
  new THREE.LatheGeometry(
    pts.map(([x, y]) => new THREE.Vector2(x, y)),
    segs,
  );

const red = enamel(PALETTE.enamelRed);
const blue = enamel(PALETTE.enamelBlue);
const dark = matte(0x2a2622, 0.5);
const cream = ceramic(PALETTE.cream);
const wood = paintedWood(PALETTE.wood);
const greenWood = paintedWood(0x4f7a58);
const mustard = paintedWood(PALETTE.mustard);
const shade = felt(0xf1dfb8, 0.4);
const brassMat = brass();
// The lamp's pole is thinner than a pixel at play distance, where anisotropy's tangent frame
// (built from screen-space UV derivatives) breaks down and blooms into a glare. Plain satin
// brass keeps its glint.
const poleMat = brass();
poleMat.roughness = 0.42;
poleMat.anisotropy = 0;
const biscuit = matte(0xdcae6a, 0.8);
export const propMaterials = [
  red,
  blue,
  dark,
  cream,
  wood,
  greenWood,
  mustard,
  shade,
  brassMat,
  poleMat,
  biscuit,
];
for (const material of propMaterials) material.userData.keepDetail = true;

function kettle() {
  const g = new THREE.Group();
  g.add(
    mesh(
      lathe([
        [0, 0],
        [0.13, 0],
        [0.15, 0.07],
        [0.13, 0.16],
        [0.06, 0.2],
        [0, 0.205],
      ]),
      red,
    ),
  );
  g.add(mesh(new THREE.SphereGeometry(0.02, 12, 8), dark, 0, 0.215, 0));
  const spout = mesh(new THREE.CylinderGeometry(0.014, 0.028, 0.14, 12), red, 0.15, 0.12, 0);
  spout.rotation.z = -0.9;
  g.add(spout);
  const handle = mesh(new THREE.TorusGeometry(0.075, 0.012, 8, 20, Math.PI), dark, 0, 0.19, 0);
  g.add(handle);
  return g;
}

function teacups() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.34, 0.12, 0.22), greenWood, 0, 0.06, 0));
  for (const x of [-0.08, 0.08]) {
    g.add(
      mesh(
        lathe(
          [
            [0.045, 0.09],
            [0.04, 0.02],
            [0, 0],
          ],
          18,
        ),
        cream,
        x,
        0.11,
        0,
      ),
    );
    const h = mesh(new THREE.TorusGeometry(0.022, 0.006, 6, 12), cream, x + 0.05, 0.16, 0);
    g.add(h);
  }
  return g;
}

function biscuitTin() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.13, 32), blue, 0, 0.065, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.03, 32), mustard, 0, 0.145, 0));
  g.add(flat(mesh(new THREE.TorusGeometry(0.151, 0.008, 6, 32), mustard, 0, 0.05, 0)));
  return g;
}

function blanketRoll() {
  const g = new THREE.Group();
  const roll = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.52, 28), tartanCloth(), 0, 0.13, 0);
  roll.rotation.z = Math.PI / 2;
  g.add(roll);
  for (const x of [-0.16, 0.16]) {
    const strap = mesh(new THREE.TorusGeometry(0.133, 0.012, 6, 28), matte(0x4a3424, 0.7), x, 0.13);
    strap.rotation.y = Math.PI / 2;
    g.add(strap);
  }
  return g;
}

function stool() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    for (const z of [-0.14, 0.14]) {
      const leg = mesh(new THREE.BoxGeometry(0.035, 0.42, 0.03), wood, 0, 0.18, z);
      leg.rotation.z = s * 0.62;
      g.add(leg);
    }
  }
  g.add(mesh(new THREE.BoxGeometry(0.46, 0.035, 0.34), mustard, 0, 0.345, 0));
  return g;
}

function lamp(lit = false) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.04, 24), brassMat, 0, 0.02, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.8, 16), poleMat, 0, 0.42, 0));
  const shadeMat = lit
    ? new THREE.MeshStandardMaterial({
        color: 0xf6e2b0,
        emissive: 0xffc070,
        emissiveIntensity: 1.4,
        roughness: 0.9,
        side: THREE.DoubleSide,
      })
    : shade;
  const s = mesh(new THREE.CylinderGeometry(0.1, 0.19, 0.24, 28, 1, true), shadeMat, 0, 0.93, 0);
  shadeMat.side = THREE.DoubleSide;
  g.add(s);
  g.add(flat(mesh(new THREE.TorusGeometry(0.19, 0.012, 6, 28), felt(0xc84b3c), 0, 0.815, 0)));
  return g;
}

const BUILDERS: Record<ItemId, () => THREE.Group> = {
  kettle,
  teacups,
  biscuits: biscuitTin,
  blanket: blanketRoll,
  chair: stool,
  lamp: () => lamp(false),
};

export function buildProp(id: ItemId): THREE.Group {
  const g = BUILDERS[id]();
  g.name = id;
  return g;
}

// Tea-scene variants: unpacked, laid out, switched on.

export function spreadBlanket() {
  const g = new THREE.Group();
  const m = mesh(new THREE.BoxGeometry(1.5, 0.02, 1.1, 1, 1, 1), tartanCloth(), 0, 0.01, 0);
  const mat = m.material as THREE.MeshPhysicalMaterial;
  if (mat.map) mat.map.repeat.set(3, 2);
  g.add(m);
  return g;
}

export function plate(withBiscuits: boolean) {
  const g = new THREE.Group();
  g.add(
    mesh(
      lathe(
        [
          [0, 0],
          [0.13, 0],
          [0.16, 0.025],
        ],
        28,
      ),
      cream,
    ),
  );
  if (withBiscuits) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const b = mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.014, 16),
        biscuit,
        Math.cos(a) * 0.07,
        0.02 + (i % 2) * 0.012,
        Math.sin(a) * 0.07,
      );
      b.rotation.x = 0.15;
      g.add(b);
    }
  }
  return g;
}

export function cup() {
  const g = new THREE.Group();
  g.add(
    mesh(
      lathe(
        [
          [0.045, 0.09],
          [0.04, 0.02],
          [0, 0],
        ],
        18,
      ),
      cream,
    ),
  );
  g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.005, 18), matte(0x7a4a24, 0.2), 0, 0.075, 0));
  g.add(mesh(new THREE.TorusGeometry(0.022, 0.006, 6, 12), cream, 0.05, 0.05, 0));
  return g;
}

export function stove() {
  const g = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const r = mesh(
      new THREE.DodecahedronGeometry(0.06),
      matte(PALETTE.rock),
      Math.cos(a) * 0.17,
      0.04,
      Math.sin(a) * 0.17,
    );
    r.rotation.set(i, i * 2, 0);
    g.add(r);
  }
  const fire = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.14, 10),
    new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff7020, emissiveIntensity: 2 }),
  );
  fire.position.y = 0.07;
  g.add(fire);
  return g;
}

export const litLamp = () => lamp(true);
