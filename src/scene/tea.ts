import gsap from "gsap";
import * as THREE from "three";
import type { ItemId } from "../game/items";
import type { TeaOutcome } from "../game/tea";
import { buildProp, cup, litLamp, plate, spreadBlanket, stove } from "./props";

// The payoff: at the lookout the bear unpacks exactly what arrived, one prop at a time.
// Slots are in the bear's local frame (it faces -Z, toward the view).

interface Slot {
  make: () => THREE.Object3D;
  at: [number, number, number];
  turn?: number;
}

const SLOTS: Partial<Record<ItemId, Slot[]>> = {
  blanket: [{ make: spreadBlanket, at: [0, 0.005, -0.55] }],
  chair: [{ make: () => buildProp("chair"), at: [0, 0, 0.05] }],
  kettle: [
    { make: stove, at: [-0.85, 0, -0.75] },
    { make: () => buildProp("kettle"), at: [-0.85, 0.08, -0.75], turn: 0.8 },
  ],
  teacups: [
    { make: cup, at: [0.3, 0.02, -0.75] },
    { make: cup, at: [0.55, 0.02, -0.55], turn: 2 },
  ],
  lamp: [{ make: litLamp, at: [0.8, 0, 0.25] }],
};

export class TeaScene {
  readonly group = new THREE.Group();
  private steam: THREE.Mesh[] = [];
  private lampLight: THREE.PointLight | null = null;
  private time = 0;

  clear() {
    gsap.killTweensOf(this.group.children.map((c) => c.scale));
    this.group.clear();
    this.steam = [];
    this.lampLight = null;
  }

  /** Lays out the arrival; returns the seat height for the bear. */
  build(outcome: TeaOutcome, calm: boolean): number {
    this.clear();
    const has = (id: ItemId) => outcome.arrived.includes(id);
    const pieces: THREE.Object3D[] = [];
    for (const id of ["blanket", "chair", "kettle", "teacups", "lamp"] as ItemId[]) {
      if (!has(id)) continue;
      for (const slot of SLOTS[id] ?? []) {
        const o = slot.make();
        o.position.set(...slot.at);
        o.rotation.y = slot.turn ?? 0;
        pieces.push(o);
      }
    }
    // The biscuit plate is always set: empty if the biscuits were lost on the way.
    if (has("biscuits") || outcome.silence) {
      const p = plate(has("biscuits"));
      p.position.set(-0.15, 0.02, -0.95);
      pieces.push(p);
    }
    if (has("lamp")) {
      this.lampLight = new THREE.PointLight(0xffc27a, 0, 4, 1.5);
      this.lampLight.position.set(0.8, 1, 0.25);
      this.group.add(this.lampLight);
    }
    if (has("kettle")) {
      const puff = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.5,
        roughness: 1,
      });
      for (let i = 0; i < 5; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), puff.clone());
        m.userData.offset = i / 5;
        this.steam.push(m);
        this.group.add(m);
      }
    }
    pieces.forEach((o, i) => {
      o.traverse((c) => {
        c.castShadow = true;
        c.receiveShadow = true;
      });
      this.group.add(o);
      if (calm) return;
      o.scale.setScalar(0.001);
      gsap.to(o.scale, {
        x: 1,
        y: 1,
        z: 1,
        duration: 0.45,
        delay: 0.6 + i * 0.28,
        ease: "back.out(2.2)",
      });
    });
    if (this.lampLight)
      gsap.to(this.lampLight, {
        intensity: 2.2,
        duration: 0.4,
        delay: calm ? 0 : 0.6 + pieces.length * 0.28,
      });
    return has("chair") ? 0.2 : -0.08;
  }

  update(dt: number) {
    this.time += dt;
    for (const m of this.steam) {
      const k = (this.time * 0.35 + (m.userData.offset as number)) % 1;
      m.position.set(-0.7 + Math.sin(k * 6) * 0.05, 0.4 + k * 0.7, -0.88);
      m.scale.setScalar(0.6 + k * 1.8);
      (m.material as THREE.MeshStandardMaterial).opacity = 0.45 * (1 - k);
    }
  }
}
