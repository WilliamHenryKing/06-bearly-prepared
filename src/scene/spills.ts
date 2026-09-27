import * as THREE from "three";
import type { ItemId } from "../game/items";
import type { Ground } from "./terrain";

// Items that slid off: they tumble in an arc, bounce softly in the grass and wait to be
// fetched. Dust puffs mark every landing so the spill always reads.

interface Falling {
  id: ItemId;
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  resting: boolean;
  bounces: number;
}

export class Spills {
  readonly group = new THREE.Group();
  private items: Falling[] = [];
  private puffs: { mesh: THREE.Mesh; age: number }[] = [];
  private puffGeo = new THREE.SphereGeometry(0.08, 8, 6);
  private puffMat = new THREE.MeshStandardMaterial({
    color: 0xf1e8d2,
    transparent: true,
    roughness: 1,
  });

  constructor(private ground: Ground) {}

  /** Detach an item from the stack (keeping its world transform) and throw it sideways. */
  drop(id: ItemId, obj: THREE.Object3D, side: THREE.Vector3, calm: boolean) {
    this.group.attach(obj);
    const vel = side
      .clone()
      .multiplyScalar(calm ? 1.2 : 1.9)
      .add(new THREE.Vector3(0, calm ? 0.8 : 2.2, 0));
    const spin = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      -side.x,
    ).multiplyScalar(calm ? 2 : 7);
    this.items.push({ id, obj, vel, spin, resting: false, bounces: 0 });
  }

  /** Remove a fetched item's ground copy. */
  take(id: ItemId) {
    const i = this.items.findIndex((f) => f.id === id);
    const f = this.items[i];
    if (!f) return;
    this.puff(f.obj.position);
    this.group.remove(f.obj);
    this.items.splice(i, 1);
  }

  clear() {
    for (const f of this.items) this.group.remove(f.obj);
    this.items = [];
  }

  puff(at: THREE.Vector3, n = 6) {
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(this.puffGeo, this.puffMat.clone());
      mesh.position
        .copy(at)
        .add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.05, (Math.random() - 0.5) * 0.5));
      this.group.add(mesh);
      this.puffs.push({ mesh, age: 0 });
    }
  }

  update(dt: number) {
    for (const f of this.items) {
      if (f.resting) continue;
      f.vel.y -= 9.8 * dt;
      f.obj.position.addScaledVector(f.vel, dt);
      f.obj.rotation.x += f.spin.x * dt;
      f.obj.rotation.y += f.spin.y * dt;
      f.obj.rotation.z += f.spin.z * dt;
      const floor = this.ground.height(f.obj.position.x, f.obj.position.z) + 0.02;
      if (f.obj.position.y <= floor && f.vel.y < 0) {
        f.obj.position.y = floor;
        f.bounces++;
        this.puff(f.obj.position, f.bounces === 1 ? 7 : 3);
        f.vel.multiplyScalar(0.35);
        f.vel.y = Math.abs(f.vel.y) + (f.bounces < 3 ? 1.2 / f.bounces : 0);
        f.spin.multiplyScalar(0.4);
        if (f.bounces >= 3) {
          f.resting = true;
          // Settle onto its side or base, whichever is closer.
          f.obj.rotation.x = Math.round(f.obj.rotation.x / (Math.PI / 2)) * (Math.PI / 2);
          f.obj.rotation.z = Math.round(f.obj.rotation.z / (Math.PI / 2)) * (Math.PI / 2);
        }
      }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      if (!p) continue;
      p.age += dt;
      p.mesh.position.y += dt * 0.4;
      p.mesh.scale.setScalar(1 + p.age * 3);
      (p.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 0.7 - p.age * 1.2);
      if (p.age > 0.6) {
        this.group.remove(p.mesh);
        this.puffs.splice(i, 1);
      }
    }
  }
}
