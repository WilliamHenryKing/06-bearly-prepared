import * as THREE from "three";
import { CHECKPOINTS, LOGS, type PathPoint, pointAt, TRAIL_LENGTH } from "../game/trail";
import { felt, matte, PALETTE, paintedWood } from "./materials";

// Set dressing: the authored logs,
// checkpoint flags and the lookout platform where tea is taken.

export function buildDressing(path: readonly PathPoint[]) {
  const group = new THREE.Group();
  group.add(buildLogs(path));
  const flags = buildFlags(path);
  group.add(flags.group);
  group.add(buildLookout(path));
  return { group, flags: flags.items };
}

function buildLogs(path: readonly PathPoint[]) {
  const g = new THREE.Group();
  const bark = felt(PALETTE.bark, 0.3);
  const cut = paintedWood(0xd8b27a);
  for (const log of LOGS) {
    const pt = pointAt(path, log.at);
    const holder = new THREE.Group();
    holder.position.set(pt.x, pt.y, pt.z);
    holder.rotation.y = pt.heading;
    // The log sits higher on the side opposite its lurch: you stumble downhill.
    holder.rotation.z = log.lurch * 0.1;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 2.4, 14), bark);
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.12;
    body.castShadow = body.receiveShadow = true;
    holder.add(body);
    for (const x of [-1.2, 1.2]) {
      const end = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 14), cut);
      end.rotation.z = Math.PI / 2;
      end.position.set(x, 0.12, 0);
      holder.add(end);
    }
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2), matte(PALETTE.rock));
    stone.position.set(-log.lurch * 1.0, 0.02, 0);
    stone.castShadow = true;
    holder.add(stone);
    g.add(holder);
  }
  return g;
}

function buildFlags(path: readonly PathPoint[]) {
  const group = new THREE.Group();
  const items: THREE.Mesh[] = [];
  const pole = paintedWood(0xe8e0cc);
  for (const at of CHECKPOINTS.slice(1)) {
    const pt = pointAt(path, at);
    const rx = Math.cos(pt.heading);
    const rz = -Math.sin(pt.heading);
    const g = new THREE.Group();
    g.position.set(pt.x + rx * 1.25, pt.y, pt.z + rz * 1.25);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 8), pole);
    stick.position.y = 0.65;
    stick.castShadow = true;
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.45, 0.28),
      new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.9, side: THREE.DoubleSide }),
    );
    flag.position.set(0.24, 1.14, 0);
    flag.rotation.y = pt.heading;
    g.add(stick, flag);
    items.push(flag);
    group.add(g);
  }
  return { group, items };
}

function buildLookout(path: readonly PathPoint[]) {
  const end = pointAt(path, TRAIL_LENGTH + 1.2);
  const g = new THREE.Group();
  g.position.set(end.x, end.y, end.z);
  g.rotation.y = end.heading;
  const plank = paintedWood(0xb98a52);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.12, 3.6), plank);
  deck.position.y = -0.04;
  deck.receiveShadow = deck.castShadow = true;
  g.add(deck);
  const rail = paintedWood(0x6d4a2c);
  for (const [x, z, w, d] of [
    [0, -1.8, 4.2, 0.08],
    [-2.1, 0, 0.08, 3.6],
    [2.1, 0, 0.08, 3.6],
  ] as const) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, d), rail);
    bar.position.set(x, 0.75, z);
    bar.castShadow = true;
    g.add(bar);
  }
  for (const [x, z] of [
    [-2.1, -1.8],
    [2.1, -1.8],
    [-2.1, 1.8],
    [2.1, 1.8],
    [0, -1.8],
  ] as const) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.1), rail);
    post.position.set(x, 0.4, z);
    post.castShadow = true;
    g.add(post);
  }
  return g;
}
