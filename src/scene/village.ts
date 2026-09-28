import * as THREE from "three";
import { BRANCH_REACH, BRANCHES, GOOSE, type GooseState } from "../game/obstacles";
import { GREEN, LANE, ORCHARD, type PathPoint, pointAt } from "../game/trail";
import { paintedWood } from "./materials";

// The three new stretches of the walk, dressed to match what the rules test there:
// - the village green: benches, lamp posts strung with bunting and a sign that explains why
//   nobody here is looking where they are going (the crowd is crowd.ts);
// - the orchard: apple trees, five of them reaching a low bough over the path at exactly the
//   heights the rules check (BRANCHES); a clipped bough shakes and drops an apple;
// - Goose Lane: fences and gates, and the goose itself, which follows the rules' goose (asleep
//   by the first gate, then waddling hard after the bear with its neck out, pecking and honking,
//   until it gives up at the far gate).

type Ground = (x: number, z: number) => number;

const wood = paintedWood(0x6d4a2c);
const iron = new THREE.MeshStandardMaterial({ color: 0x1f3a2c, roughness: 0.45, metalness: 0.6 });
const leafMat = new THREE.MeshStandardMaterial({
  color: 0x3f6b2a,
  roughness: 0.85,
  flatShading: true,
});
const barkMat = new THREE.MeshStandardMaterial({ color: 0x5b4431, roughness: 0.95 });
const appleMat = new THREE.MeshStandardMaterial({ color: 0xb8231c, roughness: 0.35 });

/** A point beside the path: `side` metres to the walker's right, standing on the ground. */
function beside(path: readonly PathPoint[], ground: Ground, d: number, side: number) {
  const p = pointAt(path, d);
  const x = p.x + Math.cos(p.heading) * side;
  const z = p.z - Math.sin(p.heading) * side;
  return { x, y: Math.min(ground(x, z), p.y + 0.6), z, heading: p.heading, pathY: p.y };
}

function signTexture(lines: string[], bg: string, wifi = false) {
  const c = document.createElement("canvas");
  c.width = 320;
  c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = bg;
    g.fillRect(0, 0, 320, 128);
    g.strokeStyle = "#f6eedb";
    g.lineWidth = 4;
    g.setLineDash([8, 6]);
    g.strokeRect(8, 8, 304, 112);
    g.setLineDash([]);
    g.fillStyle = "#f6eedb";
    g.textAlign = "center";
    g.textBaseline = "middle";
    const x = wifi ? 190 : 160;
    lines.forEach((line, i) => {
      g.font = `${i === 0 ? 800 : 600} ${i === 0 ? 34 : 22}px ui-rounded, system-ui, sans-serif`;
      g.fillText(line, x, 50 + i * 36 - (lines.length - 1) * 8);
    });
    if (wifi) {
      g.lineWidth = 7;
      g.lineCap = "round";
      for (const r of [14, 28, 42]) {
        g.beginPath();
        g.arc(60, 92, r, -Math.PI * 0.78, -Math.PI * 0.22);
        g.stroke();
      }
      g.beginPath();
      g.arc(60, 92, 5, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function signBoard(lines: string[], bg: string, wifi = false) {
  const g = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 0.08), wood);
  stick.position.y = 0.75;
  const face = new THREE.MeshStandardMaterial({
    map: signTexture(lines, bg, wifi),
    roughness: 0.7,
  });
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.44, 0.05), [
    wood,
    wood,
    wood,
    wood,
    face,
    wood,
  ]);
  board.position.set(0, 1.42, 0.05);
  for (const m of [stick, board]) m.castShadow = true;
  g.add(stick, board);
  return g;
}

function bench() {
  const g = new THREE.Group();
  const slat = new THREE.BoxGeometry(1.5, 0.04, 0.1);
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(slat, wood);
    s.position.set(0, 0.45, -0.18 + i * 0.12);
    g.add(s);
  }
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(slat, wood);
    s.position.set(0, 0.62 + i * 0.13, 0.26);
    s.rotation.x = -0.18;
    g.add(s);
  }
  for (const x of [-0.65, 0.65]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.46), iron);
    leg.position.set(x, 0.225, 0);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), iron);
    back.position.set(x, 0.7, 0.27);
    g.add(leg, back);
  }
  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

function lamp() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 3.1, 10), iron);
  pole.position.y = 1.55;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.1, 0.34, 6), iron);
  head.position.y = 3.25;
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.09, 0.24, 6),
    new THREE.MeshStandardMaterial({
      color: 0xfff1c9,
      emissive: 0xffc46b,
      emissiveIntensity: 0.4,
      roughness: 0.2,
    }),
  );
  glass.position.y = 3.22;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.18, 6), iron);
  cap.position.y = 3.5;
  g.add(pole, head, glass, cap);
  pole.castShadow = true;
  return g;
}

/** Triangular flags on a sagging line from a to b. */
function bunting(a: THREE.Vector3, b: THREE.Vector3) {
  const g = new THREE.Group();
  const colours = [0xc84b3c, 0xe0b040, 0x3f7fae, 0x5b9a4a, 0xf6eedb];
  const n = Math.max(6, Math.round(a.distanceTo(b) / 0.42));
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = a.clone().lerp(b, t);
    p.y -= Math.sin(t * Math.PI) * 0.45;
    pts.push(p);
  }
  const line = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, 0.008, 4, false),
    new THREE.MeshStandardMaterial({ color: 0xece4d0, roughness: 0.9 }),
  );
  g.add(line);
  const tri = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.13, 0, 0),
    new THREE.Vector3(0.13, 0, 0),
    new THREE.Vector3(0, -0.26, 0),
  ]);
  tri.computeVertexNormals();
  const dir = b.clone().sub(a).setY(0).normalize();
  const yaw = Math.atan2(dir.x, dir.z) + Math.PI / 2;
  for (let i = 1; i < n; i++) {
    const flag = new THREE.Mesh(
      tri,
      new THREE.MeshStandardMaterial({
        color: colours[i % colours.length],
        roughness: 0.8,
        side: THREE.DoubleSide,
      }),
    );
    flag.position.copy(pts[i] as THREE.Vector3);
    flag.rotation.y = yaw;
    flag.userData.phase = i * 0.7;
    g.add(flag);
  }
  return g;
}

function appleTree(rand: () => number) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.9, 8), barkMat);
  trunk.position.y = 0.95;
  trunk.rotation.z = (rand() - 0.5) * 0.12;
  trunk.castShadow = true;
  g.add(trunk);
  const crown = new THREE.Group();
  const blob = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(blob, leafMat);
    const a = (i / 6) * Math.PI * 2 + rand();
    const r = i === 0 ? 0 : 0.7 + rand() * 0.35;
    m.position.set(Math.cos(a) * r, 2.35 + rand() * 0.5 + (i === 0 ? 0.35 : 0), Math.sin(a) * r);
    m.scale.setScalar(i === 0 ? 1.05 : 0.7 + rand() * 0.25);
    m.castShadow = true;
    crown.add(m);
  }
  g.add(crown);
  // Apples on the outside of the crown.
  const apple = new THREE.SphereGeometry(0.055, 8, 6);
  const apples = new THREE.InstancedMesh(apple, appleMat, 26);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const y = 1.9 + rand() * 1.1;
    const r = 1.25 + rand() * 0.35 - Math.abs(y - 2.5) * 0.4;
    m4.makeTranslation(Math.cos(a) * r, y, Math.sin(a) * r);
    apples.setMatrixAt(i, m4);
  }
  apples.castShadow = true;
  g.add(apples);
  return g;
}

/** A low bough from a tree beside the path, reaching over it: leaves with their lowest point at
 * `height` above the path, `BRANCH_REACH` past the centre line. */
function bough(side: number, height: number, rand: () => number) {
  const g = new THREE.Group();
  const from = new THREE.Vector3(side * 3.3, 2.05, 0);
  const tip = new THREE.Vector3(-side * BRANCH_REACH, height + 0.28, 0);
  const curve = new THREE.CatmullRomCurve3([
    from,
    new THREE.Vector3(side * 2.2, 2.2, 0.1),
    new THREE.Vector3(side * 1.0, height + 0.55, -0.05),
    tip,
  ]);
  const limb = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.045, 6, false), barkMat);
  limb.castShadow = true;
  g.add(limb);
  const blob = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 5; i++) {
    const t = 0.55 + i * 0.11;
    const p = curve.getPoint(Math.min(1, t));
    const m = new THREE.Mesh(blob, leafMat);
    const s = 0.24 + rand() * 0.1;
    m.scale.set(s * 1.3, s, s * 1.1);
    m.position.set(
      p.x,
      Math.max(height + s * 0.95, p.y + (rand() - 0.3) * 0.1),
      p.z + (rand() - 0.5) * 0.3,
    );
    m.castShadow = true;
    g.add(m);
  }
  const apple = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), appleMat);
  apple.position.set(tip.x + side * 0.25, height + 0.05, 0.1);
  apple.name = "apple";
  g.add(apple);
  return g;
}

function fence(length: number) {
  const g = new THREE.Group();
  const posts = Math.max(2, Math.round(length / 2.4) + 1);
  for (let i = 0; i < posts; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.0, 0.09), wood);
    p.position.set(0, 0.5, -(i / (posts - 1)) * length);
    p.castShadow = true;
    g.add(p);
  }
  for (const y of [0.45, 0.82]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, length), wood);
    rail.position.set(0, y, -length / 2);
    rail.castShadow = true;
    g.add(rail);
  }
  return g;
}

/** A goose: white, orange-billed, about knee-high to a person and every bit as cross as that. */
class Goose {
  readonly root = new THREE.Group();
  private body: THREE.Group;
  private neck: THREE.Group;
  private head: THREE.Group;
  private beakLow: THREE.Mesh;
  private legs: THREE.Mesh[] = [];
  private wings: THREE.Mesh[] = [];
  private t = 0;
  private peck = 0;
  private honk = 0;

  constructor() {
    const white = new THREE.MeshStandardMaterial({ color: 0xf3f1ea, roughness: 0.8 });
    const grey = new THREE.MeshStandardMaterial({ color: 0xc9c6bd, roughness: 0.85 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xe8872a, roughness: 0.5 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.3 });
    this.body = new THREE.Group();
    this.body.position.y = 0.36;
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12), white);
    torso.scale.set(0.85, 0.72, 1.35);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.2, 10), grey);
    tail.rotation.x = -Math.PI / 2 - 0.5;
    tail.position.set(0, 0.07, 0.3);
    this.body.add(torso, tail);
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), grey);
      wing.scale.set(0.25, 0.55, 1.1);
      wing.position.set(s * 0.15, 0.04, 0.04);
      this.body.add(wing);
      this.wings.push(wing);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.26, 6), orange);
      leg.position.set(s * 0.07, 0.13, 0.02);
      const foot = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.02, 3), orange);
      foot.position.set(0, -0.13, -0.03);
      foot.rotation.set(0, Math.PI, 0);
      foot.scale.set(1, 1, 1.4);
      leg.add(foot);
      this.root.add(leg);
      this.legs.push(leg);
    }
    this.neck = new THREE.Group();
    this.neck.position.set(0, 0.1, -0.2);
    const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 0.34, 10), white);
    neckMesh.position.y = 0.17;
    this.neck.add(neckMesh);
    this.head = new THREE.Group();
    this.head.position.y = 0.34;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.058, 14, 10), white);
    skull.scale.set(0.85, 0.9, 1.2);
    const beakUp = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.09, 8), orange);
    beakUp.rotation.x = -Math.PI / 2;
    beakUp.position.set(0, -0.004, -0.1);
    this.beakLow = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.075, 8), orange);
    this.beakLow.rotation.x = -Math.PI / 2;
    this.beakLow.position.set(0, -0.018, -0.095);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 6), black);
      eye.position.set(s * 0.042, 0.018, -0.03);
      this.head.add(eye);
    }
    this.head.add(skull, beakUp, this.beakLow);
    this.neck.add(this.head);
    this.body.add(this.neck);
    this.root.add(this.body);
    this.root.traverse((o) => {
      o.castShadow = true;
    });
    this.root.scale.setScalar(1.25);
  }

  doPeck() {
    this.peck = 1;
  }
  doHonk() {
    this.honk = 1;
  }

  update(state: GooseState["state"], speed: number, dt: number) {
    this.t += dt;
    this.peck = Math.max(0, this.peck - dt * 4);
    this.honk = Math.max(0, this.honk - dt * 2.2);
    const run = state === "chasing" ? Math.min(1, speed / 1.2) : 0;
    const step = this.t * (5 + run * 9);
    // Waddle: the body rolls and bobs with each step.
    this.body.rotation.z = Math.sin(step) * (0.06 + run * 0.12);
    this.body.position.y = 0.36 + Math.abs(Math.sin(step)) * 0.03 * (0.4 + run);
    this.legs.forEach((leg, i) => {
      leg.rotation.x = Math.sin(step + i * Math.PI) * (0.25 + run * 0.6);
    });
    // Wings half open when charging.
    this.wings.forEach((w, i) => {
      const s = i === 0 ? -1 : 1;
      w.rotation.z = s * (run * (0.5 + Math.sin(this.t * 14) * 0.15));
    });
    // Neck: tucked asleep; stretched low and forward to hiss when charging; up to honk.
    if (state === "asleep") {
      this.neck.rotation.x = 1.9;
      this.head.rotation.x = -1.2;
    } else {
      const lunge = Math.sin(this.peck * Math.PI);
      this.neck.rotation.x = run * 0.95 - this.honk * 0.5 + lunge * 0.6;
      this.head.rotation.x = -run * 0.7 + this.honk * 0.4 - lunge * 0.3;
    }
    this.beakLow.rotation.x =
      -Math.PI / 2 + (run * 0.35 + this.honk * 0.6) * (0.6 + 0.4 * Math.sin(this.t * 30));
  }
}

export class Village {
  readonly group = new THREE.Group();
  private flags: THREE.Mesh[] = [];
  private boughs: THREE.Group[] = [];
  private shake: number[] = [];
  private goose = new Goose();
  private fallen: { mesh: THREE.Mesh; v: THREE.Vector3; ground: number; t: number }[] = [];
  private time = 0;

  constructor(
    private path: readonly PathPoint[],
    private ground: Ground,
  ) {
    let seed = 7127;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const put = (obj: THREE.Object3D, d: number, side: number, turn = 0) => {
      const b = beside(path, ground, d, side);
      obj.position.set(b.x, b.y, b.z);
      obj.rotation.y = b.heading + turn;
      this.group.add(obj);
      return b;
    };

    // The village green.
    put(signBoard(["Village green", "mind the walkers"], "#4f7a58"), GREEN.from - 3.5, 1.45);
    put(signBoard(["FREE Wi-Fi", "everywhere!"], "#2f6f8a", true), GREEN.from + 1.5, -1.6, 0.3);
    for (const [d, side] of [
      [76, -3.3],
      [86, 3.4],
      [94, -3.1],
      [101, 3.3],
    ] as const)
      put(bench(), d, side, side > 0 ? Math.PI / 2 : -Math.PI / 2);
    const tops: Record<string, THREE.Vector3> = {};
    for (const d of [76, 86, 96]) {
      for (const side of [-2.4, 2.4]) {
        const b = put(lamp(), d, side);
        tops[`${d}:${side}`] = new THREE.Vector3(b.x, b.y + 3.05, b.z);
      }
      const across = bunting(tops[`${d}:-2.4`] as THREE.Vector3, tops[`${d}:2.4`] as THREE.Vector3);
      this.group.add(across);
      across.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o.userData.phase !== undefined)
          this.flags.push(o as THREE.Mesh);
      });
    }

    // The orchard: a row of apple trees each side, and the five low boughs.
    put(signBoard(["Orchard", "low branches!"], "#8a5a2b"), ORCHARD.from - 3, 1.45);
    for (let d = ORCHARD.from + 1; d < ORCHARD.to - 1; d += 4.6) {
      put(appleTree(rand), d, -3.4 - rand() * 0.6, rand() * 6);
      put(appleTree(rand), d + 2.3, 3.4 + rand() * 0.6, rand() * 6);
    }
    for (const br of BRANCHES) {
      const p = pointAt(path, br.at);
      const g = bough(br.side, br.height, rand);
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = p.heading;
      this.group.add(g);
      this.boughs.push(g);
      this.shake.push(0);
      // Its tree.
      put(appleTree(rand), br.at, br.side * 3.4);
    }

    // Goose Lane: fences both sides, a gate at each end, and a warning.
    put(signBoard(["Goose Lane", "do NOT stop"], "#9e3529"), LANE.from - 3, 1.45);
    for (const side of [-1.55, 1.55]) {
      for (let d = LANE.from; d < LANE.to; d += 4) {
        const a = beside(path, ground, d, side);
        const b = beside(path, ground, Math.min(LANE.to, d + 4), side);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const f = fence(len);
        f.position.set(a.x, a.pathY, a.z);
        f.rotation.y = Math.atan2(-(b.x - a.x), -(b.z - a.z));
        this.group.add(f);
      }
    }
    for (const d of [LANE.from, LANE.to]) {
      const gate = fence(1.4);
      put(gate, d, 1.5, d === LANE.from ? -1.2 : 1.2);
    }
    this.group.add(this.goose.root);
  }

  /** A clipped bough: shake it and drop its apple. */
  bump(branchAt: number) {
    const i = BRANCHES.findIndex((b) => b.at === branchAt);
    if (i < 0) return;
    this.shake[i] = 1;
    const apple = this.boughs[i]?.getObjectByName("apple") as THREE.Mesh | undefined;
    if (apple?.visible) {
      const world = apple.getWorldPosition(new THREE.Vector3());
      apple.visible = false;
      const m = apple.clone();
      m.visible = true;
      m.position.copy(world);
      this.group.add(m);
      this.fallen.push({
        mesh: m,
        v: new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.3, (Math.random() - 0.5) * 0.6),
        ground: this.ground(world.x, world.z) + 0.05,
        t: 0,
      });
    }
  }

  gooseEvent(kind: "honk" | "peck" | "steal" | "quit") {
    if (kind === "peck") this.goose.doPeck();
    else this.goose.doHonk();
  }

  /** Put the apples back (a new run). */
  reset() {
    for (const b of this.boughs) {
      const a = b.getObjectByName("apple");
      if (a) a.visible = true;
    }
    for (const f of this.fallen) this.group.remove(f.mesh);
    this.fallen = [];
  }

  update(goose: GooseState, dt: number, calm: boolean) {
    this.time += dt;
    // Bunting flutters.
    for (const f of this.flags)
      f.rotation.x = Math.sin(this.time * 3 + (f.userData.phase as number)) * (calm ? 0.05 : 0.18);
    // Boughs shake after a clip, and sway a little always.
    this.boughs.forEach((b, i) => {
      const k = this.shake[i] as number;
      this.shake[i] = Math.max(0, k - dt * 1.4);
      b.rotation.z = Math.sin(this.time * 1.3 + i) * 0.01 + Math.sin(this.time * 22) * 0.08 * k * k;
    });
    for (const f of this.fallen) {
      f.t += dt;
      f.v.y -= 9.8 * dt;
      f.mesh.position.addScaledVector(f.v, dt);
      if (f.mesh.position.y < f.ground) {
        f.mesh.position.y = f.ground;
        f.v.y = Math.abs(f.v.y) * 0.35;
        f.v.x *= 0.7;
        f.v.z *= 0.7;
      }
    }
    // The goose, on the rules' own track: a little off the centre line, facing the bear.
    const d = Math.max(0, goose.d);
    const p = pointAt(this.path, d);
    const side = 0.25 * Math.sin(this.time * 0.9);
    const x = p.x + Math.cos(p.heading) * side;
    const z = p.z - Math.sin(p.heading) * side;
    this.goose.root.position.set(x, p.y, z);
    this.goose.root.rotation.y = p.heading;
    this.goose.root.visible = goose.state !== "done" || d < GOOSE.quit + 3;
    this.goose.update(goose.state, goose.speed, dt);
  }
}
