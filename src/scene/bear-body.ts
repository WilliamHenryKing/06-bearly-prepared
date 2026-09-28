// The bear's body, generated rather than downloaded: one continuous signed-distance sculpt (smooth
// unions of ellipsoids and capsules, eye sockets carved in) meshed by surface nets, snapped onto
// the exact surface, skinned to the rig in bear-rig.ts and painted with the attributes the fur
// shader reads. Pure and deterministic; runs in a worker at load (bear-body.worker.ts).
//
// Per vertex: position, normal (the field's gradient), four joints and weights, fur (length ÷ 1.5,
// cream, dark, pad as normalised bytes) and comb (the unit tangent the fur lies along).

import { type BoneName, boneIndex, EYE_RADIUS, EYES, MOUTH, NOSE } from "./bear-rig";
import {
  above,
  blend,
  capsule,
  carve,
  ellipsoid,
  len,
  noise3,
  rotateAbout,
  rotationInverse,
  type Sdf,
  sphere,
  surfaceNets,
  union,
  type Vec3,
} from "./sdf";

export interface BodyMesh {
  positions: Float32Array;
  normals: Float32Array;
  joints: Uint8Array;
  weights: Uint8Array;
  fur: Uint8Array;
  comb: Float32Array;
  indices: Uint32Array;
}
export interface PlainMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/** Fur length is stored ÷ this in a normalised byte. */
export const FUR_LENGTH_RANGE = 1.5;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const ss = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const norm = (v: Vec3): Vec3 => {
  const l = len(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const along = (p: Vec3, a: Vec3, b: Vec3) => {
  const ab = sub(b, a);
  const t =
    (ab[0] * (p[0] - a[0]) + ab[1] * (p[1] - a[1]) + ab[2] * (p[2] - a[2])) /
    (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2);
  return clamp(t, 0, 1);
};

interface Fur {
  len: number;
  cream: number;
  dark: number;
  pad: number;
}
interface Part {
  sdf: Sdf;
  len: number;
  cream?: number;
  dark?: number;
  bones: (p: Vec3) => Partial<Record<BoneName, number>>;
  comb: (p: Vec3) => Vec3;
  paint?: (p: Vec3, n: Vec3, f: Fur) => void;
}

// ---- the sculpt --------------------------------------------------------------------------------
const parts: Part[] = [];
const add = (p: Part) => {
  parts.push(p);
  return p.sdf;
};
const down = (): Vec3 => [0, -1, 0.3];
const awayFromNose = (p: Vec3): Vec3 => sub(p, [0, 0.99, -0.32]);

const barrel = add({
  sdf: ellipsoid([0.27, 0.3, 0.245], [0, 0.63, 0.01]),
  len: 1,
  bones: (p) => {
    const c = ss(0.6, 0.8, p[1]);
    return { chest: c, spine: 1 - c };
  },
  comb: down,
});
const belly = add({
  sdf: ellipsoid([0.245, 0.22, 0.22], [0, 0.55, -0.05]),
  len: 0.9,
  bones: (p) => {
    const front = 0.55 * ss(-0.1, -0.24, p[2]);
    return { belly: front, spine: 1 - front };
  },
  comb: down,
});
const chest = add({
  sdf: ellipsoid([0.235, 0.15, 0.19], [0, 0.8, 0.02]),
  len: 1.1,
  bones: () => ({ chest: 1 }),
  comb: () => [0, -1, 0.5],
});
const haunch = (s: number) =>
  add({
    sdf: ellipsoid([0.14, 0.13, 0.14], [s * 0.1, 0.45, 0.06]),
    len: 1.05,
    bones: (p) => {
      const t = 0.7 * (1 - ss(0.36, 0.52, p[1]));
      return { [s < 0 ? "thighL" : "thighR"]: t, hips: 1 - t };
    },
    comb: () => [s * 0.3, -1, 0.4],
  });
const tail = add({
  sdf: sphere(0.055, [0, 0.5, 0.235]),
  len: 1.35,
  dark: 0.15,
  bones: () => ({ tail: 1 }),
  comb: () => [0, -0.6, 1],
});
const neck = add({
  sdf: capsule([0, 0.85, 0.005], [0, 0.99, -0.01], 0.15, 0.15),
  len: 1.25,
  bones: (p) => {
    const h = ss(0.91, 1.0, p[1]);
    const c = 1 - ss(0.83, 0.9, p[1]);
    return { head: h, chest: c, neck: Math.max(0, 1 - h - c) };
  },
  comb: () => [0, -1, 0.6],
});
const head = add({
  sdf: ellipsoid([0.212, 0.19, 0.195], [0, 1.07, -0.005]),
  len: 0.68,
  bones: () => ({ head: 1 }),
  comb: awayFromNose,
});
const cheek = (s: number) =>
  add({
    sdf: ellipsoid([0.1, 0.08, 0.1], [s * 0.095, 1.01, -0.075]),
    len: 1.15,
    bones: () => ({ head: 1 }),
    comb: () => [s, -0.6, 0.6],
  });
const snout = add({
  sdf: ellipsoid([0.094, 0.072, 0.105], [0, 1.0, -0.165]),
  len: 0.3,
  cream: 1,
  bones: () => ({ head: 1 }),
  comb: awayFromNose,
});

// Ears: tilted discs with a cupped front of short cream fur.
const earTilt = (s: number): Vec3 => [0, s * 0.35, -s * 0.3];
const earAt = (s: number): Vec3 => [s * 0.15, 1.215, 0.02];
const ear = (s: number) => {
  const c = earAt(s);
  const toLocal = rotationInverse(earTilt(s));
  return add({
    sdf: rotateAbout(
      carve(
        0.012,
        ellipsoid([0.068, 0.066, 0.03], c),
        ellipsoid([0.046, 0.046, 0.028], [c[0], c[1] + 0.006, c[2] - 0.026]),
      ),
      earTilt(s),
      c,
    ),
    len: 0.55,
    dark: 0.2,
    bones: () => ({ [s < 0 ? "earL" : "earR"]: 1 }),
    comb: (p) => sub(p, [s * 0.14, 1.17, 0.02]),
    paint: (p, _n, f) => {
      const l = toLocal(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
      const inner = ss(-0.004, -0.018, l[2]) * (1 - ss(0.04, 0.058, len(l[0], l[1] - 0.006)));
      f.cream = Math.max(f.cream, inner * 0.75);
      f.len *= 1 - inner * 0.45;
      f.dark *= 1 - inner;
    },
  });
};

const shoulder = (s: number): Vec3 => [s * 0.21, 0.81, -0.01];
const wrist = (s: number): Vec3 => [s * 0.285, 0.53, -0.05];
const arm = (s: number) =>
  add({
    sdf: capsule(shoulder(s), wrist(s), 0.078, 0.066),
    len: 0.85,
    bones: (p) => {
      const f = ss(0.44, 0.64, along(p, shoulder(s), wrist(s)));
      return s < 0 ? { armL: 1 - f, foreArmL: f } : { armR: 1 - f, foreArmR: f };
    },
    comb: () => [s * 0.25, -1, 0.15],
  });
const paw = (s: number) =>
  add({
    sdf: ellipsoid([0.07, 0.066, 0.072], [s * 0.292, 0.5, -0.058]),
    len: 0.55,
    dark: 0.75,
    bones: () => (s < 0 ? { foreArmL: 1 } : { foreArmR: 1 }),
    comb: () => [0, -1, -0.2],
    paint: (_p, n, f) => {
      f.pad = Math.max(f.pad, ss(-0.35, -0.8, n[1]) * 0.8);
    },
  });
const hip = (s: number): Vec3 => [s * 0.12, 0.47, 0.01];
const ankle = (s: number): Vec3 => [s * 0.13, 0.11, 0];
const leg = (s: number) =>
  add({
    sdf: capsule(hip(s), ankle(s), 0.095, 0.08),
    len: 0.9,
    bones: (p) => {
      const t = ss(0.47, 0.64, along(p, hip(s), ankle(s)));
      return s < 0 ? { thighL: 1 - t, shinL: t } : { thighR: 1 - t, shinR: t };
    },
    comb: () => [s * 0.15, -1, 0.15],
  });
const SOLE = 0.008;
const foot = (s: number) =>
  add({
    sdf: above(ellipsoid([0.085, 0.052, 0.125], [s * 0.13, 0.055, -0.045]), SOLE),
    len: 0.5,
    dark: 0.75,
    bones: (p) => {
      const shin = 0.5 * ss(0.075, 0.115, p[1]);
      return s < 0 ? { footL: 1 - shin, shinL: shin } : { footR: 1 - shin, shinR: shin };
    },
    comb: () => [0, -0.4, -1],
    paint: (p, n, f) => {
      f.pad = Math.max(f.pad, ss(SOLE + 0.012, SOLE + 0.002, p[1]) * ss(-0.5, -0.85, n[1]));
    },
  });

const torso = blend(0.07, barrel, belly, chest);
const trunk = blend(0.06, torso, haunch(-1), haunch(1), tail);
const face = blend(0.045, head, cheek(-1), cheek(1), snout);
const headAll = blend(0.022, face, ear(-1), ear(1));
const upper = blend(0.075, trunk, neck, headAll);
let body: Sdf = blend(
  0.045,
  upper,
  blend(0.035, arm(-1), paw(-1)),
  blend(0.035, arm(1), paw(1)),
  blend(0.035, leg(-1), foot(-1)),
  blend(0.035, leg(1), foot(1)),
);
for (const e of EYES) body = carve(0.012, body, sphere(EYE_RADIUS + 0.002, e));
const mouth = union(
  ...MOUTH.flatMap((line) => line.slice(1).map((b, i) => capsule(line[i] as Vec3, b, 0.004))),
);

const gradient = (sdf: Sdf, x: number, y: number, z: number): Vec3 => {
  const e = 0.0006;
  return norm([
    sdf.d(x + e, y, z) - sdf.d(x - e, y, z),
    sdf.d(x, y + e, z) - sdf.d(x, y - e, z),
    sdf.d(x, y, z + e) - sdf.d(x, y, z - e),
  ]);
};

/** Mesh a field and pull every vertex onto its zero set (Newton steps along the gradient). */
function snapped(sdf: Sdf, voxel: number) {
  const net = surfaceNets(sdf, voxel);
  const p = net.positions;
  const normals = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    let x = p[i] as number;
    let y = p[i + 1] as number;
    let z = p[i + 2] as number;
    // One Newton step: surface nets leave vertices within half a voxel, and the step lands them
    // well under a millimetre from the surface. The final gradient is the shading normal.
    const d = sdf.d(x, y, z);
    const g = gradient(sdf, x, y, z);
    x -= g[0] * d;
    y -= g[1] * d;
    z -= g[2] * d;
    p[i] = x;
    p[i + 1] = y;
    p[i + 2] = z;
    normals.set(gradient(sdf, x, y, z), i);
  }
  return { positions: p, normals, indices: net.indices };
}

const byte = (v: number) => Math.round(clamp(v, 0, 1) * 255);

/** The skinned, fur-painted body at the given voxel size (metres). */
export function buildBody(voxel: number): BodyMesh {
  const { positions, normals, indices } = snapped(body, voxel);
  const count = positions.length / 3;
  const joints = new Uint8Array(count * 4);
  const weights = new Uint8Array(count * 4);
  const fur = new Uint8Array(count * 4);
  const comb = new Float32Array(count * 3);
  const TAU = 0.025;
  const own = new Float64Array(parts.length);
  for (let i = 0; i < count; i++) {
    const p: Vec3 = [
      positions[i * 3] as number,
      positions[i * 3 + 1] as number,
      positions[i * 3 + 2] as number,
    ];
    const n: Vec3 = [
      normals[i * 3] as number,
      normals[i * 3 + 1] as number,
      normals[i * 3 + 2] as number,
    ];
    // Soft ownership of the vertex by each part, from the parts' own distance fields.
    let total = 0;
    parts.forEach((part, k) => {
      const w = Math.exp(-Math.max(0, part.sdf.d(p[0], p[1], p[2])) / TAU);
      own[k] = w;
      total += w;
    });
    const bw = new Map<number, number>();
    const f: Fur = { len: 0, cream: 0, dark: 0, pad: 0 };
    const c: Vec3 = [0, 0, 0];
    parts.forEach((part, k) => {
      const w = (own[k] as number) / total;
      if (w < 1e-4) return;
      for (const [name, v] of Object.entries(part.bones(p)) as [BoneName, number][]) {
        const j = boneIndex(name);
        bw.set(j, (bw.get(j) ?? 0) + w * v);
      }
      f.len += w * part.len;
      f.cream += w * (part.cream ?? 0);
      f.dark += w * (part.dark ?? 0);
      const d = norm(part.comb(p));
      c[0] += w * d[0];
      c[1] += w * d[1];
      c[2] += w * d[2];
    });
    parts.forEach((part, k) => {
      if ((own[k] as number) / total > 0.3) part.paint?.(p, n, f);
    });

    // Regions that cut across parts: the cream belly patch, a darker mask and short fur around
    // the eyes, short fur by the nose and along the mouth.
    const patch =
      len(p[0] / 0.155, (p[1] - 0.57) / 0.2) + noise3(p[0] * 30, p[1] * 30, p[2] * 30, 5) * 0.12;
    f.cream = Math.max(f.cream, (1 - ss(0.78, 1.0, patch)) * ss(-0.12, -0.2, p[2]));
    for (const eye of EYES) {
      const d = len(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]) - EYE_RADIUS;
      f.len *= 0.25 + 0.75 * ss(0.004, 0.03, d);
      f.dark = Math.max(f.dark, 0.35 * (1 - ss(0.01, 0.045, d)));
    }
    f.len *= 0.3 + 0.7 * ss(0.003, 0.014, mouth.d(p[0], p[1], p[2]));
    const toNose = len(p[0] - NOSE[0], p[1] - NOSE[1], p[2] - NOSE[2]);
    f.len *= 0.35 + 0.65 * ss(0.03, 0.06, toNose);
    f.len *= 1 - f.pad;

    const dn = c[0] * n[0] + c[1] * n[1] + c[2] * n[2];
    let t = norm([c[0] - n[0] * dn, c[1] - n[1] * dn, c[2] - n[2] * dn]);
    if (!(len(...t) > 0.5)) {
      // Comb along the normal: fall back to "downhill" on the surface, or sideways at the poles.
      const g: Vec3 = [n[0] * n[1], n[1] * n[1] - 1, n[2] * n[1]];
      t = len(...g) > 1e-3 ? norm(g) : norm([n[2], 0, -n[0]]);
    }
    comb.set(t, i * 3);

    // Four strongest bones; weights floored to bytes, the remainder to the strongest, sum 255.
    const top = [...bw.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((a, [, v]) => a + v, 0) || 1;
    let left = 255;
    top.forEach(([j, v], k) => {
      const q = Math.floor((v / sum) * 255);
      left -= q;
      joints[i * 4 + k] = j;
      weights[i * 4 + k] = q;
    });
    weights[i * 4] = (weights[i * 4] as number) + left;
    fur.set([byte(f.len / FUR_LENGTH_RANGE), byte(f.cream), byte(f.dark), byte(f.pad)], i * 4);
  }
  return { positions, normals, joints, weights, fur, comb, indices };
}

/** The leathery nose: a rounded wedge with nostrils, rigid on the head. */
export function buildNose(voxel = 0.0032): PlainMesh {
  const n = NOSE;
  const nose = carve(
    0.004,
    blend(
      0.012,
      ellipsoid([0.043, 0.029, 0.03], n),
      ellipsoid([0.026, 0.02, 0.026], [n[0], n[1] - 0.016, n[2] + 0.004]),
    ),
    union(
      ellipsoid([0.009, 0.006, 0.012], [n[0] - 0.017, n[1] - 0.004, n[2] - 0.028]),
      ellipsoid([0.009, 0.006, 0.012], [n[0] + 0.017, n[1] - 0.004, n[2] - 0.028]),
    ),
  );
  return snapped(nose, voxel);
}
