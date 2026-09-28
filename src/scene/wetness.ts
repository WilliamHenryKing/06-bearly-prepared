import * as THREE from "three";
import type { Bear } from "./bear";
import type { BoneName } from "./bear-rig";
import { furUniforms } from "./fur";
import { Droplets, type Pond } from "./pond";

// How wet the bear is, and what the water does: the fur soaks up to the water line and a little
// above while wading (splashes spatter higher), then dries from the top down: slowly in the
// meadow, faster in the ledge wind. A second after climbing out, a soaked bear shakes itself
// off: spray flies, the fur frizzes up and slowly settles. Wet fur drips from its lowest points.

/** Where drips gather and fall, in the bind pose, with the bone that carries them. */
const DRIPS: { bone: BoneName; at: [number, number, number] }[] = [
  { bone: "footL", at: [-0.13, 0.02, -0.12] },
  { bone: "footR", at: [0.13, 0.02, -0.12] },
  { bone: "shinL", at: [-0.15, 0.2, -0.06] },
  { bone: "shinR", at: [0.15, 0.2, -0.06] },
  { bone: "tail", at: [0, 0.44, 0.26] },
  { bone: "belly", at: [0, 0.34, -0.13] },
  { bone: "belly", at: [0.11, 0.37, -0.11] },
  { bone: "belly", at: [-0.11, 0.37, -0.11] },
  { bone: "foreArmL", at: [-0.3, 0.43, -0.07] },
  { bone: "foreArmR", at: [0.3, 0.43, -0.07] },
  { bone: "head", at: [0, 0.94, -0.2] },
];
/** Points the spray of a shake flies from. */
const SPRAY: { bone: BoneName; at: [number, number, number] }[] = [
  { bone: "chest", at: [0, 0.78, -0.2] },
  { bone: "chest", at: [0.25, 0.72, 0] },
  { bone: "chest", at: [-0.25, 0.72, 0] },
  { bone: "head", at: [0.18, 1.08, 0] },
  { bone: "head", at: [-0.18, 1.08, 0] },
  { bone: "spine", at: [0, 0.55, -0.24] },
  { bone: "armL", at: [-0.3, 0.7, -0.03] },
  { bone: "armR", at: [0.3, 0.7, -0.03] },
];

const tmp = new THREE.Vector3();
const vel = new THREE.Vector3();
let seed = 11;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

export class Wetness {
  /** Bind-space height the fur is soaked to (below 0: dry). */
  line = -1;
  soak = 0;
  splash = 0;
  frizz = 0;
  readonly droplets: Droplets;
  /** Called when a shake-off starts (for sound). */
  onShake: (() => void) | null = null;
  private outFor = 99;
  private shook = true;
  private dripIn = 0;
  private wakeIn = 0;

  constructor(
    private bear: Bear,
    private pond: Pond,
  ) {
    this.droplets = new Droplets(
      280,
      (x, z) => (this.pond.depthAt(x, z) > 0 ? this.pond.level : this.bear.root.position.y),
      (x, z, strength) => {
        if (this.pond.depthAt(x, z) > 0) this.pond.ripple(x, z, strength);
      },
    );
  }

  reset() {
    this.line = -1;
    this.soak = 0;
    this.splash = 0;
    this.frizz = 0;
    this.outFor = 99;
    this.shook = true;
    this.droplets.clear();
    this.apply();
  }

  /** Evidence captures: set the state directly. */
  set(line: number, soak: number, splash = 0, frizz = 0) {
    this.line = line;
    this.soak = soak;
    this.splash = splash;
    this.frizz = frizz;
    this.apply();
  }

  /** Water surface height above the bear's feet (0 on land). */
  private waterAbove() {
    const p = this.bear.root.position;
    return this.pond.depthAt(p.x, p.z) > 0.005 ? Math.max(0, this.pond.level - p.y) : 0;
  }

  /** A footfall: in the water it splashes. Returns whether it did. */
  footfall(side: number, strength: number) {
    const above = this.waterAbove();
    if (above < 0.02) return false;
    const foot = this.bear.pointOn(side < 0 ? "footL" : "footR", [side * 0.13, 0.03, -0.06], tmp);
    this.pond.ripple(foot.x, foot.z, 0.9 + strength * 0.4);
    const n = Math.round(6 + strength * 8);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const out = 0.4 + rand() * 0.8;
      vel.set(Math.cos(a) * out, 1 + rand() * 1.6 * strength, Math.sin(a) * out);
      this.droplets.emit(tmp.set(foot.x, this.pond.level + 0.01, foot.z), vel, 1.2);
    }
    this.splash = Math.min(0.6, this.splash + 0.05 * strength);
    return true;
  }

  update(dt: number, speed: number, windy: boolean) {
    const above = this.waterAbove();
    const p = this.bear.root.position;
    if (above > 0.03) {
      // The fur wicks a few centimetres above the water; moving through it pushes it higher.
      this.line = Math.max(this.line, above + 0.03 + Math.min(0.06, speed * 0.04));
      this.soak = Math.min(1, this.soak + dt * 3);
      this.outFor = 0;
      this.shook = false;
      this.wakeIn -= dt;
      if (this.wakeIn <= 0 && speed > 0.1) {
        this.pond.ripple(p.x, p.z, 0.5);
        this.wakeIn = 0.25;
      }
    } else {
      this.outFor += dt;
      const rate = windy ? 2.2 : 1;
      if (this.soak > 0) this.line = Math.max(-1, this.line - dt * 0.008 * rate);
      this.soak = Math.max(0, this.soak - dt * 0.006 * rate);
      this.splash = Math.max(0, this.splash - dt * 0.012 * rate);
      if (!this.shook && this.outFor > 0.6 && this.soak > 0.6 && this.line > 0.12) {
        this.shook = true;
        this.bear.shake();
        this.line -= 0.05;
        this.splash *= 0.5;
        this.onShake?.();
      }
    }
    this.frizz = Math.max(0, this.frizz - dt * 0.035);

    // Spray while shaking: drops leave the fur tangentially to the twist, and outward.
    const shaking = this.bear.shaking;
    if (shaking > 0 && dt > 0) {
      this.frizz = Math.max(this.frizz, shaking);
      const n = Math.round(110 * dt * shaking * Math.max(this.soak, 0.3)) + (rand() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const s = SPRAY[Math.floor(rand() * SPRAY.length)] as (typeof SPRAY)[number];
        const at = this.bear.pointOn(s.bone, s.at, tmp);
        const dx = at.x - p.x;
        const dz = at.z - p.z;
        const len = Math.hypot(dx, dz) || 1;
        const spin = (rand() < 0.5 ? -1 : 1) * (1.6 + rand() * 1.6);
        vel.set(
          (dx / len) * (0.8 + rand()) + (-dz / len) * spin,
          0.5 + rand() * 1.4,
          (dz / len) * (0.8 + rand()) + (dx / len) * spin,
        );
        this.droplets.emit(at, vel, 1.4);
      }
    }

    // Drips from the lowest wet points, more the wetter the fur.
    if (this.soak > 0.15 && this.line > 0.02 && dt > 0) {
      this.dripIn -= dt * (3 + 12 * this.soak);
      while (this.dripIn < 0) {
        this.dripIn += 1;
        const wet = DRIPS.filter((d) => d.at[1] < this.line);
        const d = wet[Math.floor(rand() * wet.length)];
        if (!d) break;
        const at = this.bear.pointOn(d.bone, d.at, tmp);
        at.x += (rand() - 0.5) * 0.05;
        at.z += (rand() - 0.5) * 0.05;
        this.droplets.emit(at, vel.set(0, -0.2, 0), 1.2);
      }
    }
    this.droplets.update(dt);
    this.apply();
  }

  private apply() {
    furUniforms.uWetLine.value = this.line;
    furUniforms.uSoak.value = this.soak;
    furUniforms.uSplash.value = this.splash;
    furUniforms.uFrizz.value = this.frizz;
  }
}
