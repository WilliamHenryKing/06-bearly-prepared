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
  /** Wet fur to hold: soak line (m), soak, splash, frizz. */
  wet?: [number, number, number, number];
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
  pond: {
    d: 35.1,
    load: TALL,
    tilt: 0.04,
    eye: [1.7, 0.35, 0.95],
    look: [0, 0, 0.3],
    fov: 40,
    viewport: DESK,
    wet: [0.34, 1, 0.3, 0],
  },
  "pond-top": {
    d: 35.1,
    load: TALL,
    tilt: 0,
    eye: [2.5, 0.5, 6],
    look: [0, -0.7, 0],
    fov: 50,
    viewport: DESK,
    wet: [0.34, 1, 0.3, 0],
  },
  /** The trailhead, for films of the opening stretch. */
  start: {
    d: 0.5,
    load: ["kettle", "blanket", "teacups"],
    tilt: 0,
    eye: [-4, 0.6, 2.4],
    look: [5, 0, 0.3],
    fov: 42,
    viewport: DESK,
  },
  /** Start of the pond film: walking in from the meadow. */
  "pond-approach": {
    d: 30.5,
    load: ["kettle", "blanket", "teacups"],
    tilt: 0,
    eye: [-4, 0.6, 2.4],
    look: [5, 0, 0.3],
    fov: 42,
    viewport: DESK,
  },
  /** Climbing out of the pond: a fixed camera on the far bank for the shake and the drips. */
  "pond-exit": {
    d: 35.9,
    load: ["kettle", "blanket", "teacups"],
    tilt: 0,
    eye: [3.3, 3.1, 1.75],
    look: [2.6, 0, 0.55],
    fov: 36,
    viewport: DESK,
    wet: [0.36, 1, 0.3, 0],
  },
  wet: {
    d: 40.6,
    load: TALL,
    tilt: 0.05,
    eye: [1.5, 1.05, 1.05],
    look: [0, 0, 0.62],
    fov: 42,
    viewport: DESK,
    wet: [0.3, 0.85, 0.25, 0.35],
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
