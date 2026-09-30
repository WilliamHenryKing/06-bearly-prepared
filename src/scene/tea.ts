import gsap from "gsap";
import * as THREE from "three";
import type { ItemId } from "../game/items";
import type { TeaOutcome } from "../game/tea";
import { buildProp, cup, litLamp, plate, spreadBlanket, stove } from "./props";
import { SceneResources } from "./resources";

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
    { make: () => buildProp("kettle"), at: [-0.85, 0.08, -0.75] },
  ],
  teacups: [
    { make: cup, at: [-0.55, 0.02, -0.75] },
    { make: cup, at: [0.55, 0.02, -0.55], turn: 2 },
  ],
  lamp: [{ make: litLamp, at: [0.8, 0, 0.25] }],
};

export class TeaScene {
  readonly group = new THREE.Group();
  private steam: THREE.Mesh[] = [];
  private lampLight: THREE.PointLight | null = null;
  private time = 0;
  private kettle: THREE.Object3D | null = null;
  private stream: THREE.Mesh | null = null;
  /** When the kettle tips to pour, seconds after arrival. */
  private pourAt = -1;
  private calm = false;
  private tweens: gsap.core.Tween[] = [];
  /** When each unpacked piece appears, for the sound of it landing. */
  pops: { id: ItemId; delay: number }[] = [];

  constructor(private resources = new SceneResources()) {}

  clear() {
    for (const tween of this.tweens) tween.kill();
    this.tweens = [];
    for (const child of [...this.group.children]) this.resources.retire(child);
    this.group.clear();
    this.steam = [];
    this.kettle = null;
    this.stream = null;
    this.pourAt = -1;
    this.lampLight = null;
    this.pops = [];
    this.time = 0;
  }

  /** Lays out the arrival; returns the seat height for the bear. */
  build(outcome: TeaOutcome, calm: boolean): number {
    this.clear();
    this.calm = calm;
    const has = (id: ItemId) => outcome.arrived.includes(id);
    const pieces: THREE.Object3D[] = [];
    for (const id of ["blanket", "chair", "kettle", "teacups", "lamp"] as ItemId[]) {
      if (!has(id)) continue;
      for (const slot of SLOTS[id] ?? []) {
        const o = slot.make();
        o.position.set(...slot.at);
        o.rotation.y = slot.turn ?? 0;
        o.userData.item = id;
        pieces.push(o);
      }
    }
    // The biscuit plate is always set: empty if the biscuits were lost on the way.
    if (has("biscuits") || outcome.silence) {
      const p = plate(has("biscuits"));
      p.position.set(-0.15, 0.02, -0.95);
      p.userData.item = has("biscuits") ? "biscuits" : "teacups";
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
      puff.dispose();
    }
    this.time = 0;
    this.kettle = pieces.find((o) => o.name === "kettle") ?? null;
    if (this.kettle && has("teacups")) {
      this.stream = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.012, 0.08, 6),
        new THREE.MeshStandardMaterial({ color: 0x8a5a2a, roughness: 0.2 }),
      );
      this.stream.position.set(-0.56, 0.12, -0.75);
      this.stream.visible = false;
      this.group.add(this.stream);
      this.pourAt = (calm ? 0.3 : 0.6) + pieces.length * 0.28 + 2.6;
    }
    this.pops = pieces.map((o, i) => ({
      id: o.userData.item as ItemId,
      delay: calm ? 0.3 + i * 0.12 : 0.6 + i * 0.28,
    }));
    pieces.forEach((o, i) => {
      o.traverse((c) => {
        c.castShadow = true;
        c.receiveShadow = true;
      });
      this.group.add(o);
      if (calm) return;
      o.scale.setScalar(0.001);
      this.tweens.push(
        gsap.to(o.scale, {
          x: 1,
          y: 1,
          z: 1,
          duration: 0.45,
          delay: 0.6 + i * 0.28,
          ease: "back.out(2.2)",
        }),
      );
    });
    if (this.lampLight && !calm)
      this.tweens.push(
        gsap.to(this.lampLight, {
          intensity: 2.2,
          duration: 0.4,
          delay: calm ? 0 : 0.6 + pieces.length * 0.28,
        }),
      );
    if (this.lampLight && calm) this.lampLight.intensity = 2.2;
    this.resources.tree(this.group);
    if (calm) this.setCalm(true);
    return has("chair") ? 0.2 : -0.08;
  }

  update(dt: number) {
    if (this.calm) return;
    this.time += dt;
    // Pour: the kettle tips toward the cup beside it, a trickle of tea, then back upright.
    if (this.kettle && this.pourAt >= 0) {
      const u = (this.time - this.pourAt) / 1.8;
      const tip = u > 0 && u < 1 ? Math.sin(u * Math.PI) : 0;
      this.kettle.rotation.z = -0.6 * Math.min(1, tip * 1.6);
      if (this.stream) this.stream.visible = tip > 0.55;
    }
    for (const m of this.steam) {
      const k = (this.time * 0.35 + (m.userData.offset as number)) % 1;
      m.position.set(-0.7 + Math.sin(k * 6) * 0.05, 0.4 + k * 0.7, -0.88);
      m.scale.setScalar(0.6 + k * 1.8);
      (m.material as THREE.MeshStandardMaterial).opacity = 0.45 * (1 - k);
    }
  }

  /** Finish reveals/pour and hold the steam when the preference changes live. */
  setCalm(calm: boolean) {
    this.calm = calm;
    if (!calm) {
      for (const steam of this.steam) steam.visible = true;
      return;
    }
    for (const tween of this.tweens) tween.totalProgress(1).kill();
    this.tweens = [];
    if (this.kettle) this.kettle.rotation.z = 0;
    if (this.stream) this.stream.visible = false;
    if (this.pourAt >= 0) this.time = Math.max(this.time, this.pourAt + 1.8);
    this.pourAt = -1;
    for (const steam of this.steam) steam.visible = false;
  }
}
