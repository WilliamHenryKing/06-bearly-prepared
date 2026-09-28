import * as THREE from "three";
import { LEDGE, type PathPoint, pointAt } from "../game/trail";

// The camera sits behind and above the bear and looks a few metres up the trail, blending
// toward where the path is going so corners, logs and the ledge are seen before they arrive.

export type CameraMode = "pack" | "hike" | "tea";

const sideFor = (d: number) => (d > LEDGE.from - 3 && d < LEDGE.to ? -1 : 1);

export class CameraRig {
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private ready = false;
  /** -1 left … 1 right: which shoulder the camera looks over. */
  private side = 1;
  /** Seconds since arriving at the lookout. */
  teaTime = 0;

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
      // First watch the bear settle and pour, then drift round behind it as the view opens.
      const t = this.teaTime;
      const k = t < 4 ? 0 : Math.min(1, (t - 4) / 4);
      const e = k * k * (3 - 2 * k);
      const front = base
        .clone()
        .addScaledVector(fwd, portrait ? 4.4 : 3.3)
        .addScaledVector(right, portrait ? 1.6 : 2);
      front.y += 1.5;
      const behind = base
        .clone()
        .addScaledVector(fwd, -3)
        .addScaledVector(right, portrait ? 0.9 : 1.9);
      behind.y += 2.9;
      pos.copy(front).lerp(behind, e);
      const lookFront = base
        .clone()
        .addScaledVector(fwd, 0.4)
        .setY(here.y + 0.5);
      const lookView = base
        .clone()
        .addScaledVector(fwd, 7)
        .setY(here.y - 0.6);
      look.copy(lookFront).lerp(lookView, e);
    } else {
      // Three-quarter follow: close and to one side so the stack fills the frame and its lean
      // reads clearly, still looking a little up the trail. On the ledge the camera swings out
      // over the drop so the cliff and the wind are in view.
      const toAhead = new THREE.Vector3(ahead.x - here.x, 0, ahead.z - here.z).normalize();
      const dir = fwd.clone().lerp(toAhead, 0.35).normalize();
      const across = new THREE.Vector3(-dir.z, 0, dir.x);
      this.side += (sideFor(d) - this.side) * Math.min(1, dt * 1.2);
      const back = (portrait ? 4.3 : 3.4) + loadHeight * 1.1;
      pos
        .copy(base)
        .addScaledVector(dir, -back)
        .addScaledVector(across, this.side * (portrait ? 1.3 : 2));
      pos.y += 1.6 + loadHeight * 0.8 + (portrait ? 0.5 : 0);
      look.copy(base).addScaledVector(dir, 1.8);
      look.y = here.y + 0.85 + loadHeight * 0.55;
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
