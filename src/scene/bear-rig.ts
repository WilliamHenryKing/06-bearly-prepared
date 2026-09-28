// The bear's skeleton in its bind pose, shared by the body builder (scripts/build-bear.ts) and the
// runtime rig (bear.ts). Root space, metres: +Y up, the bear faces -Z, its left side is -X.
// Joint indices in the baked mesh are positions in this list, so only ever append to it.

export type BoneName =
  | "hips"
  | "spine"
  | "chest"
  | "neck"
  | "head"
  | "earL"
  | "earR"
  | "armL"
  | "foreArmL"
  | "armR"
  | "foreArmR"
  | "thighL"
  | "shinL"
  | "footL"
  | "thighR"
  | "shinR"
  | "footR"
  | "belly"
  | "tail";

export interface BoneDef {
  name: BoneName;
  parent: BoneName | null;
  /** Bind position in root space. */
  at: [number, number, number];
}

export const BONES: BoneDef[] = [
  { name: "hips", parent: null, at: [0, 0.47, 0.02] },
  { name: "spine", parent: "hips", at: [0, 0.5, 0.02] },
  { name: "chest", parent: "spine", at: [0, 0.72, 0.01] },
  { name: "neck", parent: "chest", at: [0, 0.9, 0] },
  { name: "head", parent: "neck", at: [0, 0.97, -0.01] },
  { name: "earL", parent: "head", at: [-0.14, 1.19, 0.02] },
  { name: "earR", parent: "head", at: [0.14, 1.19, 0.02] },
  { name: "armL", parent: "chest", at: [-0.21, 0.81, -0.01] },
  { name: "foreArmL", parent: "armL", at: [-0.255, 0.66, -0.03] },
  { name: "armR", parent: "chest", at: [0.21, 0.81, -0.01] },
  { name: "foreArmR", parent: "armR", at: [0.255, 0.66, -0.03] },
  { name: "thighL", parent: "hips", at: [-0.12, 0.47, 0.01] },
  { name: "shinL", parent: "thighL", at: [-0.125, 0.27, -0.008] },
  { name: "footL", parent: "shinL", at: [-0.13, 0.09, 0] },
  { name: "thighR", parent: "hips", at: [0.12, 0.47, 0.01] },
  { name: "shinR", parent: "thighR", at: [0.125, 0.27, -0.008] },
  { name: "footR", parent: "shinR", at: [0.13, 0.09, 0] },
  { name: "belly", parent: "spine", at: [0, 0.57, -0.13] },
  { name: "tail", parent: "hips", at: [0, 0.5, 0.2] },
];

export const boneIndex = (name: BoneName) => BONES.findIndex((b) => b.name === name);

const bind = (name: BoneName) => (BONES[boneIndex(name)] as BoneDef).at;
const span = (a: BoneName, b: BoneName) => {
  const p = bind(a);
  const q = bind(b);
  return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
};

/** Leg segment lengths for the two-bone IK (hip to knee, knee to ankle). */
export const THIGH = span("thighL", "shinL");
export const SHIN = span("shinL", "footL");
/** Ankle height above the sole when the foot is flat. */
export const ANKLE = bind("footL")[1];

/** Eye centres in root space (the face parts ride on the head bone). */
export const EYES: [number, number, number][] = [
  [-0.083, 1.095, -0.172],
  [0.083, 1.095, -0.172],
];
export const EYE_RADIUS = 0.026;
export const NOSE: [number, number, number] = [0, 1.028, -0.262];

/** The mouth line (a philtrum and two corners) in root space; drawn as a thin dark tube. */
export const MOUTH: [number, number, number][][] = [
  [
    [0, 1.0, -0.262],
    [0, 0.963, -0.253],
  ],
  [
    [-0.052, 0.969, -0.214],
    [-0.03, 0.958, -0.238],
    [0, 0.963, -0.253],
    [0.03, 0.958, -0.238],
    [0.052, 0.969, -0.214],
  ],
];
