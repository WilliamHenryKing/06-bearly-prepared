import * as THREE from "three";
import { type PathPoint, pointAt } from "../game/trail";

// The camera sits behind and above the bear and looks a few metres up the trail, blending
// toward where the path is going so corners, logs and the ledge are seen before they arrive.

export type CameraMode = "pack" | "hike" | "tea";

export class CameraRig {
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private ready = false;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private path: readonly PathPoint[],
  ) {}

  snap() {
    this.ready = false;
  }

  update(mode: CameraMode, d: number, loadHeight: number, dt: number, still: boolean) {
    const here = pointAt(this.path, d);
    const ahead = pointAt(this.path, d + 5);
    const portrait = this.camera.aspect < 0.8;
    const fwd = new THREE.Vector3(-Math.sin(here.heading), 0, -Math.cos(here.heading));
    const right = new THREE.Vector3(Math.cos(here.heading), 0, -Math.sin(here.heading));
    const base = new THREE.Vector3(here.x, here.y, here.z);
    const tall = 1 + loadHeight;
    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();

    if (mode === "pack") {
      const dist = (portrait ? 3.3 : 2.6) * (0.8 + tall * 0.35);
      pos
        .copy(base)
        .addScaledVector(fwd, dist)
        .addScaledVector(right, dist * 0.55);
      pos.y += 0.9 + tall * 0.55;
      look.copy(base).setY(here.y + 0.3 + tall * 0.5);
    } else if (mode === "tea") {
      pos
        .copy(base)
        .addScaledVector(fwd, portrait ? 4.4 : 3.3)
        .addScaledVector(right, portrait ? 1.6 : 2);
      pos.y += 1.5;
      look
        .copy(base)
        .addScaledVector(fwd, 0.4)
        .setY(here.y + 0.5);
    } else {
      const toAhead = new THREE.Vector3(ahead.x - here.x, 0, ahead.z - here.z).normalize();
      const dir = fwd.clone().lerp(toAhead, 0.5).normalize();
      const back = (portrait ? 6.8 : 5.6) + loadHeight * 1.2;
      pos.copy(base).addScaledVector(dir, -back);
      pos.y += (portrait ? 3.6 : 3) + loadHeight * 0.8;
      look.copy(base).addScaledVector(dir, 3.2);
      look.y = here.y + 0.6 + loadHeight * 0.45;
    }

    if (!this.ready || still) {
      this.pos.copy(pos);
      this.look.copy(look);
      this.ready = true;
    } else {
      const k = 1 - Math.exp(-dt * (mode === "hike" ? 3 : 2));
      this.pos.lerp(pos, k);
      this.look.lerp(look, k);
    }
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
