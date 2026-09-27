import * as THREE from "three";
import { felt, matte, PALETTE } from "./materials";

// The bear: a felt character built from soft primitives on a small rig. All expression comes
// from the pose each frame: walk cycle, counter-lean, a nervous upward glance when the load
// slides, blinks, ear flicks, squash on landings, sitting for tea and a comic topple.

export interface BearPose {
  speed: number;
  stepPhase: number;
  /** Load tilt, radians, positive to the bear's right. */
  tilt: number;
  lean: number;
  /** 0 … 1: how worried the bear is about the load. */
  alarm: number;
  /** Side the worry is on, -1 or 1. */
  alarmSide: number;
  /** 0 standing … 1 fully sitting. */
  sit: number;
  /** 0 upright … 1 flat on the ground. */
  flop: number;
  flopSide: number;
  /** 0 … 1 bowed head for a solemn moment. */
  bow: number;
}

export const restPose = (): BearPose => ({
  speed: 0,
  stepPhase: 0,
  tilt: 0,
  lean: 0,
  alarm: 0,
  alarmSide: 1,
  sit: 0,
  flop: 0,
  flopSide: 1,
  bow: 0,
});

export const HIP_HEIGHT = 0.42;
const LOAD_Z = 0.36;

const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};
const ellipsoid = (rx: number, ry: number, rz: number, mat: THREE.Material) => {
  const m = part(new THREE.SphereGeometry(1, 32, 24), mat);
  m.scale.set(rx, ry, rz);
  return m;
};
const pivot = (x = 0, y = 0, z = 0) => {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  return g;
};

export class Bear {
  readonly root = new THREE.Group();
  /** Carries the pack and stack; rolled by the simulated tilt about the hips. */
  readonly load = pivot(0, HIP_HEIGHT, LOAD_Z);
  private hips = pivot(0, HIP_HEIGHT, 0);
  private torso = pivot();
  private neck = pivot(0, 0.5, 0);
  private head = pivot();
  private eyes: THREE.Object3D[] = [];
  private brows: THREE.Object3D[] = [];
  private ears: THREE.Object3D[] = [];
  private arms: THREE.Group[] = [];
  private legs: THREE.Group[] = [];
  private blinkIn = 2;
  private earKick = 0;
  private squash = 0;
  private time = 0;

  constructor() {
    const fur = felt(PALETTE.fur);
    const muzzle = felt(PALETTE.muzzle, 0.5);
    const nose = new THREE.MeshPhysicalMaterial({
      color: PALETTE.nose,
      roughness: 0.35,
      clearcoat: 1,
    });
    const inner = felt(0xd9a07a, 0.4);

    this.root.add(this.hips);
    this.hips.add(this.torso);
    this.torso.add(ellipsoid(0.27, 0.31, 0.24, fur).translateY(0.2));
    const belly = ellipsoid(0.19, 0.22, 0.1, muzzle);
    belly.position.set(0, 0.16, -0.17);
    this.torso.add(belly);

    // Head.
    this.torso.add(this.neck);
    this.neck.add(this.head);
    this.head.add(ellipsoid(0.22, 0.2, 0.2, fur).translateY(0.14));
    const snout = ellipsoid(0.1, 0.075, 0.09, muzzle);
    snout.position.set(0, 0.09, -0.17);
    this.head.add(snout);
    this.head.add(ellipsoid(0.04, 0.03, 0.03, nose).translateY(0.12).translateZ(-0.255));
    for (const s of [-1, 1]) {
      const eye = ellipsoid(0.026, 0.03, 0.02, nose);
      eye.position.set(s * 0.085, 0.18, -0.175);
      const glint = part(
        new THREE.SphereGeometry(0.28, 8, 6),
        matte(0xffffff, 0.2),
        0.3,
        0.35,
        -0.8,
      );
      eye.add(glint);
      this.eyes.push(eye);
      this.head.add(eye);
      const brow = part(new THREE.CapsuleGeometry(0.009, 0.04, 4, 8), matte(PALETTE.furDark, 0.9));
      brow.rotation.z = Math.PI / 2;
      brow.position.set(s * 0.085, 0.235, -0.18);
      this.brows.push(brow);
      this.head.add(brow);
      const ear = pivot(s * 0.15, 0.3, 0.02);
      ear.add(ellipsoid(0.07, 0.07, 0.035, fur));
      ear.add(ellipsoid(0.045, 0.045, 0.02, inner).translateZ(-0.02));
      this.ears.push(ear);
      this.head.add(ear);
    }

    // Limbs.
    for (const s of [-1, 1]) {
      const arm = pivot(s * 0.25, 0.36, -0.02);
      arm.add(part(new THREE.CapsuleGeometry(0.07, 0.2, 6, 12), fur, 0, -0.14, 0));
      arm.add(ellipsoid(0.075, 0.06, 0.07, fur).translateY(-0.28));
      this.arms.push(arm);
      this.torso.add(arm);
      const leg = pivot(s * 0.13, 0.02, 0);
      leg.add(part(new THREE.CapsuleGeometry(0.09, 0.16, 6, 12), fur, 0, -0.16, 0));
      const foot = ellipsoid(0.09, 0.055, 0.13, fur);
      foot.position.set(0, -0.37, -0.04);
      leg.add(foot);
      const pad = ellipsoid(0.055, 0.02, 0.07, inner);
      pad.position.set(0, -0.36, 0.06);
      pad.rotation.x = -1.2;
      leg.add(pad);
      this.legs.push(leg);
      this.hips.add(leg);
    }

    // Backpack on the load pivot; items stack from 0.5 m above the hips.
    const canvas = felt(0xb5552e, 0.6);
    const pack = ellipsoid(0.24, 0.26, 0.14, canvas);
    pack.position.set(0, 0.26, 0);
    this.load.add(pack);
    const flap = ellipsoid(0.2, 0.08, 0.12, felt(0x8a3d22, 0.6));
    flap.position.set(0, 0.46, 0.01);
    this.load.add(flap);
    const pocket = ellipsoid(0.15, 0.1, 0.06, canvas);
    pocket.position.set(0, 0.16, 0.13);
    this.load.add(pocket);
    this.root.add(this.load);
  }

  bump(strength = 1) {
    this.earKick = Math.min(1.4, this.earKick + strength);
    this.squash = Math.min(1, this.squash + 0.6 * strength);
  }

  update(p: BearPose, dt: number, calm: boolean) {
    this.time += dt;
    const t = this.time;
    const walk = Math.min(1, p.speed / 1.4);
    const ph = p.stepPhase;
    const swing = Math.sin(ph) * 0.55 * walk;
    const bob = Math.abs(Math.cos(ph)) * 0.045 * walk;
    const breathe = calm ? 0 : Math.sin(t * 2.1) * 0.008;

    // Hips: bob, shuffle under the lean, drop to sit.
    this.hips.position.set(-p.lean * 0.05, HIP_HEIGHT + bob - p.sit * 0.2, 0);
    this.hips.rotation.set(0, Math.sin(ph) * 0.08 * walk, Math.sin(ph) * 0.05 * walk);

    // Torso leans into the player's lean and gives a little to the load's tilt.
    this.squash = Math.max(0, this.squash - dt * 3);
    const sq = Math.sin(this.squash * Math.PI) * 0.12;
    this.torso.scale.set(1 + sq * 0.5, 1 - sq + breathe, 1 + sq * 0.5);
    this.torso.rotation.set(-0.08 * walk + p.sit * 0.12, 0, -p.lean * 0.24 - p.tilt * 0.25);

    // Legs walk, or stretch out to sit.
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const leg = this.legs[i] as THREE.Group;
      leg.rotation.set(s * swing * (1 - p.sit) + p.sit * 1.35, 0, (i === 0 ? -1 : 1) * p.sit * 0.2);
    }

    // Arms swing; the arm on the falling side reaches up to steady the load.
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const reach = Math.max(0, side * p.alarmSide) * p.alarm;
      const arm = this.arms[i] as THREE.Group;
      arm.rotation.set(
        -(i === 0 ? 1 : -1) * swing * 0.8 * (1 - reach) + reach * 0.6 + p.sit * 0.9,
        0,
        side * (0.2 + reach * 2.3 + p.alarm * 0.15),
      );
    }

    // Head: glance up at the load when worried, bow for a solemn moment.
    const glance = p.alarm;
    this.neck.rotation.set(0.05 * walk, 0, -p.tilt * 0.15);
    this.head.rotation.set(
      glance * 0.55 - p.bow * 0.45 + Math.sin(ph * 2) * 0.03 * walk,
      -p.alarmSide * glance * 0.5,
      p.alarmSide * glance * 0.12,
    );

    // Eyes widen with alarm; blink when relaxed.
    this.blinkIn -= dt;
    let lid = 1 + glance * 0.35;
    if (this.blinkIn < 0) {
      lid = 0.1;
      if (this.blinkIn < -0.12) this.blinkIn = 2 + ((t * 7.3) % 2.5);
    }
    if (p.bow > 0.5) lid = 0.2;
    for (const e of this.eyes) e.scale.set(0.026, 0.03 * lid, 0.02);
    for (let i = 0; i < 2; i++) {
      const b = this.brows[i] as THREE.Object3D;
      b.position.y = 0.235 + glance * 0.03 - p.bow * 0.01;
      b.rotation.x = 0;
      b.rotation.y = (i === 0 ? 1 : -1) * (glance * 0.35 - p.bow * 0.3);
    }
    this.earKick = Math.max(0, this.earKick - dt * 2.5);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const flick = Math.sin(t * 30) * this.earKick * 0.3;
      (this.ears[i] as THREE.Object3D).rotation.set(
        -glance * 0.4 + flick,
        0,
        s * (0.15 + glance * 0.3),
      );
    }

    // Load follows the simulated tilt exactly.
    this.load.position.set(-p.lean * 0.05, HIP_HEIGHT + bob - p.sit * 0.2, LOAD_Z);
    this.load.rotation.set(0, 0, -p.tilt);

    // A topple rolls the whole bear onto its side.
    this.root.rotation.z = -p.flopSide * p.flop * 1.35;
    this.root.position.y = -p.flop * 0.05;
  }
}
