import * as THREE from "three";
import type { ItemId } from "../game/items";
import { type PathPoint, pointAt } from "../game/trail";

// Fixed camera bookmarks for visual evidence captures (see docs/visual/AUDIT.md). Each one
// places the bear at a trail distance with a load, and frames it from a camera expressed in
// the path's local frame: forward, right and up from the bear's feet.

export interface Bookmark {
  /** Trail distance the bear stands at. */
  d: number;
  load: ItemId[];
  /** Load tilt to hold, radians (a little lean reads better than dead upright). */
  tilt: number;
  /** Camera position and look target as [forward, right, up] offsets from the bear. */
  eye: [number, number, number];
  look: [number, number, number];
  fov: number;
  /** Suggested capture viewport. */
  viewport: { width: number; height: number; scale: number };
}

const TALL: ItemId[] = ["kettle", "blanket", "teacups", "chair", "lamp"];
const DESK = { width: 1440, height: 900, scale: 1 };

export const BOOKMARKS: Record<string, Bookmark> = {
  establishing: {
    d: 9,
    load: TALL,
    tilt: 0.05,
    eye: [-13, 7, 9],
    look: [14, -4, 0],
    fov: 50,
    viewport: DESK,
  },
  hero: {
    d: 21,
    load: TALL,
    tilt: 0.14,
    eye: [4.4, 2.5, 1.8],
    look: [0, 0.1, 1.75],
    fov: 42,
    viewport: DESK,
  },
  closeup: {
    d: 21,
    load: TALL,
    tilt: 0.06,
    eye: [1.05, 0.75, 1.3],
    look: [0, 0.08, 1.1],
    fov: 42,
    viewport: DESK,
  },
  material: {
    d: 45.5,
    load: TALL,
    tilt: 0,
    eye: [-1.2, 1.6, 0.32],
    look: [2.6, -0.2, 0.05],
    fov: 45,
    viewport: DESK,
  },
  ledge: {
    d: 84,
    load: TALL,
    tilt: -0.1,
    eye: [-4.5, -3.2, 2.6],
    look: [3, 0.8, 0.9],
    fov: 45,
    viewport: DESK,
  },
  "hero-portrait": {
    d: 21,
    load: TALL,
    tilt: 0.14,
    eye: [5.4, 2.4, 2],
    look: [0, 0.1, 1.8],
    fov: 58,
    viewport: { width: 390, height: 844, scale: 2 },
  },
};

export function bookmarkCamera(path: readonly PathPoint[], b: Bookmark) {
  const p = pointAt(path, b.d);
  const fwd = new THREE.Vector3(-Math.sin(p.heading), 0, -Math.cos(p.heading));
  const right = new THREE.Vector3(Math.cos(p.heading), 0, -Math.sin(p.heading));
  const at = (o: [number, number, number]) =>
    new THREE.Vector3(p.x, p.y + o[2], p.z).addScaledVector(fwd, o[0]).addScaledVector(right, o[1]);
  return { pos: at(b.eye), look: at(b.look) };
}
