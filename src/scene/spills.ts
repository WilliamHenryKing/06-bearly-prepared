import gsap from "gsap";
import * as THREE from "three";
import type { ItemId } from "../game/items";
import { SceneResources } from "./resources";
import type { Ground } from "./terrain";

// Items that slid off: they tumble in an arc, squash and bounce in the grass, skid to a stop
// and roll onto a side, then wait under a bobbing marker to be fetched. Fetching flies the
// item back up toward the stack. Dust puffs mark every landing so a spill always reads.

type Phase = "air" | "skid" | "rest" | "return";

interface Spill {
  id: ItemId;
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  phase: Phase;
  bounces: number;
  squash: number;
  t: number;
  settle: THREE.Euler | null;
  from: THREE.Vector3;
  marker: THREE.Mesh;
}

const QUARTER = Math.PI / 2;
const snap = (a: number) => Math.round(a / QUARTER) * QUARTER;

export class Spills {
  readonly group = new THREE.Group();
  private items: Spill[] = [];
  private puffs: { mesh: THREE.Mesh; age: number }[] = [];
  private puffGeo = new THREE.SphereGeometry(0.08, 8, 6);
  private puffMat = new THREE.MeshStandardMaterial({
    color: 0xf1e8d2,
    transparent: true,
    roughness: 1,
  });
  private markerGeo = new THREE.ConeGeometry(0.09, 0.2, 12).rotateX(Math.PI);
  private markerMat = new THREE.MeshStandardMaterial({
    color: 0xd9a441,
    emissive: 0x6a4a10,
    roughness: 0.5,
  });
  private time = 0;
  private calm = false;

  /** Called when a spilled item first hits the ground. */
  onLand: (id: ItemId) => void = () => {};

  constructor(
    private ground: Ground,
    private resources = new SceneResources(),
  ) {
    for (const resource of [this.puffGeo, this.puffMat, this.markerGeo, this.markerMat])
      this.resources.retain(resource);
  }

  /** Detach an item from the stack (keeping its world transform) and throw it sideways. */
  drop(id: ItemId, obj: THREE.Object3D, side: THREE.Vector3, calm: boolean) {
    gsap.killTweensOf(obj.scale);
    obj.scale.setScalar(1);
    this.resources.tree(obj);
    this.group.attach(obj);
    const vel = side
      .clone()
      .multiplyScalar(calm ? 1.2 : 2)
      .add(new THREE.Vector3(0, calm ? 0.8 : 2.4, 0));
    const spin = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      -side.x * 2,
    ).multiplyScalar(calm ? 2 : 6);
    const marker = new THREE.Mesh(this.markerGeo, this.markerMat);
    marker.visible = false;
    this.group.add(marker);
    const spill: Spill = {
      id,
      obj,
      vel,
      spin,
      phase: "air",
      bounces: 0,
      squash: 0,
      t: 0,
      settle: null,
      from: new THREE.Vector3(),
      marker,
    };
    this.items.push(spill);
    if (calm) this.settle(spill);
  }

  /** A fetched item hops back up toward `to` (the top of the stack) and vanishes into it. */
  take(id: ItemId, to?: THREE.Vector3) {
    const f = this.items.find((x) => x.id === id && x.phase !== "return");
    if (!f) return;
    if (!this.calm) this.puff(f.obj.position);
    this.group.remove(f.marker);
    if (!to || this.calm) {
      this.remove(f);
      return;
    }
    f.phase = "return";
    f.t = 0;
    f.from.copy(f.obj.position);
    f.vel.copy(to);
  }

  private remove(f: Spill) {
    this.group.remove(f.obj, f.marker);
    this.items.splice(this.items.indexOf(f), 1);
    gsap.killTweensOf(f.obj.scale);
    this.resources.retire(f.obj);
  }

  clear() {
    for (const f of [...this.items]) this.remove(f);
    for (const puff of this.puffs) this.resources.retire(puff.mesh);
    this.puffs = [];
    this.time = 0;
  }

  setCalm(calm: boolean) {
    this.calm = calm;
    if (!calm) return;
    for (const spill of [...this.items]) {
      if (spill.phase === "return") this.remove(spill);
      else if (spill.phase !== "rest") this.settle(spill);
    }
    for (const puff of this.puffs) this.resources.retire(puff.mesh);
    this.puffs = [];
  }

  private settle(spill: Spill) {
    const landing = spill.bounces === 0;
    const object = spill.obj;
    if (spill.phase === "air") object.position.addScaledVector(spill.vel.clone().setY(0), 0.3);
    object.position.y = this.ground.height(object.position.x, object.position.z) + 0.02;
    object.rotation.set(snap(object.rotation.x), object.rotation.y, snap(object.rotation.z));
    object.scale.setScalar(1);
    spill.phase = "rest";
    spill.marker.visible = true;
    if (landing) this.onLand(spill.id);
    this.step(spill, 0);
  }

  dispose() {
    this.clear();
    this.onLand = () => {};
  }

  puff(at: THREE.Vector3, n = 6) {
    if (this.calm) return;
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(this.puffGeo, this.puffMat.clone());
      mesh.position
        .copy(at)
        .add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.05, (Math.random() - 0.5) * 0.5));
      this.group.add(mesh);
      this.resources.tree(mesh);
      this.puffs.push({ mesh, age: 0 });
    }
  }

  update(dt: number) {
    if (!this.calm) this.time += dt;
    for (const f of [...this.items]) this.step(f, dt);
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      if (!p) continue;
      p.age += dt;
      p.mesh.position.y += dt * 0.4;
      p.mesh.scale.setScalar(1 + p.age * 3);
      (p.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 0.7 - p.age * 1.2);
      if (p.age > 0.6) {
        this.resources.retire(p.mesh);
        this.puffs.splice(i, 1);
      }
    }
  }

  private step(f: Spill, dt: number) {
    const o = f.obj;
    f.squash = Math.max(0, f.squash - dt * 6);
    const sq = Math.sin(f.squash * Math.PI) * 0.3;
    o.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);

    if (f.phase === "air") {
      f.vel.y -= 9.8 * dt;
      o.position.addScaledVector(f.vel, dt);
      o.rotation.x += f.spin.x * dt;
      o.rotation.y += f.spin.y * dt;
      o.rotation.z += f.spin.z * dt;
      const floor = this.ground.height(o.position.x, o.position.z) + 0.02;
      if (o.position.y <= floor && f.vel.y < 0) {
        o.position.y = floor;
        f.bounces++;
        f.squash = 1;
        if (f.bounces === 1) this.onLand(f.id);
        this.puff(o.position, f.bounces === 1 ? 8 : 3);
        f.vel.x *= 0.55;
        f.vel.z *= 0.55;
        f.vel.y = Math.abs(f.vel.y) * 0.4 + (f.bounces < 3 ? 1.1 / f.bounces : 0);
        f.spin.multiplyScalar(0.5);
        if (f.bounces >= 3) {
          f.phase = "skid";
          f.t = 0;
          f.settle = new THREE.Euler(snap(o.rotation.x), o.rotation.y, snap(o.rotation.z));
        }
      }
    } else if (f.phase === "skid") {
      // Slide to a stop in the grass while rolling onto the nearest side.
      f.t += dt;
      const k = Math.min(1, dt * 6);
      f.vel.multiplyScalar(1 - Math.min(1, dt * 4));
      o.position.x += f.vel.x * dt;
      o.position.z += f.vel.z * dt;
      o.position.y = this.ground.height(o.position.x, o.position.z) + 0.02;
      if (f.settle) {
        o.rotation.x += (f.settle.x - o.rotation.x) * k;
        o.rotation.z += (f.settle.z - o.rotation.z) * k;
      }
      if (f.t > 0.6) {
        f.phase = "rest";
        f.marker.visible = true;
      }
    } else if (f.phase === "rest") {
      const box = new THREE.Box3().setFromObject(o);
      f.marker.position.set(
        o.position.x,
        box.max.y + 0.3 + Math.sin(this.time * 4) * 0.06,
        o.position.z,
      );
      if (!this.calm) f.marker.rotation.y += dt * 2;
    } else {
      // Return: an arc from the grass to the top of the stack.
      f.t += dt / 0.55;
      const t = Math.min(1, f.t);
      o.position.lerpVectors(f.from, f.vel, t);
      o.position.y += Math.sin(t * Math.PI) * 1.2;
      o.rotation.x *= 0.85;
      o.rotation.z *= 0.85;
      o.scale.setScalar(1 - t * 0.7);
      if (t >= 1) this.remove(f);
    }
  }
}
