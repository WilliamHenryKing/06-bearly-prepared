import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { PbrSet } from "./textures";

// Modelled conifers instead of cones: a tapered, bark-textured trunk carrying whorls of drooping
// branch cards. Needle sprays are painted once into an RGBA canvas (twig, needles, alpha).
// Foliage normals point away from the crown's axis so the canopy shades as a soft volume.
// A few variants are built and then instanced with scale, rotation and hue jitter.

let seed = 71;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

function needleTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 512;
  const g = c.getContext("2d");
  if (g) {
    g.clearRect(0, 0, 256, 512);
    g.lineCap = "round";
    // Main twig up the middle with side twigs, each bristling with needles.
    const twig = (x0: number, y0: number, x1: number, y1: number, len: number, width: number) => {
      g.strokeStyle = "#5a4430";
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      const n = Math.hypot(x1 - x0, y1 - y0) / 2.2;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const x = x0 + (x1 - x0) * t;
        const y = y0 + (y1 - y0) * t;
        const a = Math.atan2(y1 - y0, x1 - x0);
        for (const s of [-1, 1]) {
          const ang = a + s * (0.9 + rand() * 0.5);
          const l = len * (0.75 + rand() * 0.5) * (1 - t * 0.35);
          const hue = 105 + rand() * 30;
          const light = 18 + rand() * 16;
          g.strokeStyle = `hsl(${hue} ${35 + rand() * 25}% ${light}%)`;
          g.lineWidth = 1.6;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + Math.cos(ang) * l, y + Math.sin(ang) * l);
          g.stroke();
        }
      }
    };
    twig(128, 505, 128, 20, 26, 5);
    for (let i = 0; i < 9; i++) {
      const y = 470 - i * 50 - rand() * 12;
      for (const s of [-1, 1]) {
        const len = 80 - i * 5 + rand() * 20;
        twig(128, y, 128 + s * len, y - len * 0.9, 18, 2.4);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** One drooping branch card from the trunk outward, in three segments. */
function branchCard(length: number, width: number, droop: number) {
  const g = new THREE.PlaneGeometry(width, length, 1, 3);
  // Plane lies in XY with V along +Y: rotate so it lies along +X from the trunk, then droop.
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i);
    const v = pos.getY(i) / length + 0.5; // 0 at trunk, 1 at tip
    const along = v * length;
    const y = -droop * v * v * length + Math.abs(u) * 0.12;
    pos.setXYZ(i, along, y, u);
  }
  g.computeVertexNormals();
  return g;
}

export interface TreeVariant {
  trunk: THREE.BufferGeometry;
  foliage: THREE.BufferGeometry;
  height: number;
}

export function buildTreeVariant(height: number, whorls: number, perWhorl: number): TreeVariant {
  const trunk = new THREE.CylinderGeometry(0.035, 0.12 + height * 0.01, height * 0.96, 8, 4);
  trunk.translate(0, height * 0.48, 0);
  const tuv = trunk.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tuv.getX(i) * 2, tuv.getY(i) * height * 0.8);

  const cards: THREE.BufferGeometry[] = [];
  const crownR = height * 0.34;
  for (let w = 0; w < whorls; w++) {
    const t = w / (whorls - 1);
    const y = height * (0.1 + t * 0.86);
    const r = crownR * (1 - t) ** 0.85 + 0.25;
    const n = Math.max(4, Math.round(perWhorl * (1 - t * 0.45)));
    const spin = rand() * Math.PI;
    for (let k = 0; k < n; k++) {
      const len = r * (0.8 + rand() * 0.35);
      const card = branchCard(len, 0.5 + len * 0.45, 0.28 + rand() * 0.2 + (1 - t) * 0.12);
      card.rotateZ(0.12 + t * 0.25);
      card.rotateY(spin + (k / n) * Math.PI * 2 + rand() * 0.3);
      card.translate(0, y + rand() * 0.1, 0);
      cards.push(card);
    }
  }
  // A leader of crossed cards at the top.
  for (let k = 0; k < 2; k++) {
    const tip = new THREE.PlaneGeometry(0.34, height * 0.14);
    tip.translate(0, height * 0.97, 0);
    tip.rotateY((k * Math.PI) / 2);
    cards.push(tip);
  }
  const foliage = mergeGeometries(cards.map((c) => c.toNonIndexed()));
  if (!foliage) throw new Error("tree foliage merge failed");
  // Crown-volume normals: away from the trunk axis, lifted toward the sky.
  const pos = foliage.getAttribute("position") as THREE.BufferAttribute;
  const nor = foliage.getAttribute("normal") as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), (pos.getY(i) - height * 0.45) * 0.35 + 0.6, pos.getZ(i)).normalize();
    nor.setXYZ(i, v.x, v.y, v.z);
  }
  return { trunk, foliage, height };
}

export function treeMaterials(bark: PbrSet) {
  const trunk = new THREE.MeshStandardMaterial({
    map: bark.colour,
    normalMap: bark.normal,
    roughnessMap: bark.arm,
    aoMap: bark.arm,
    roughness: 1,
  });
  const foliage = new THREE.MeshStandardMaterial({
    map: needleTexture(),
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.85,
  });
  return { trunk, foliage };
}
