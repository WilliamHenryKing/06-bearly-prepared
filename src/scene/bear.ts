import * as THREE from "three";
import type { BodyMesh, PlainMesh } from "./bear-body";
import { loadBody } from "./bear-loader";
import { ANKLE, BONES, type BoneName, EYE_RADIUS, EYES, MOUTH, SHIN, THIGH } from "./bear-rig";
import { buildFur, FUR_COLOURS, type FurLayers, furUniforms } from "./fur";
import { canvasCloth } from "./materials";

// The bear: a continuous furred body on a skeleton (bear-rig.ts), built at load from a
// signed-distance sculpt (bear-body.ts) and dressed in shell fur (fur.ts). All expression comes
// from the pose each frame. The walk plants its feet with two-bone leg IK and moves the body over
// them: weight shifts onto the stance foot, the pelvis bobs, rolls and turns, the shoulders
// counter-rotate, arms swing against the legs, and springs give the head, ears, belly and tail
// their follow-through. Heavier loads crouch the walk, lean it forward and widen the waddle.

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
  /** 0 … 1: the flop is a forward faceplant (tripping over a log) rather than a sideways topple. */
  flopForward: number;
  /** 0 … 1: in the air (a jump). */
  air: number;
  /** 0 … 1 bowed head for a solemn moment. */
  bow: number;
  /** 0 … 1 dismay just after something falls; `reactSide` is where it fell. */
  react: number;
  reactSide: number;
  /** Extra turn of the whole bear, radians (turning back to fetch). */
  turn: number;
  /** 0 … 1 how heavy the load is: crouches and slows the gait. */
  load: number;
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
  flopForward: 0,
  air: 0,
  bow: 0,
  react: 0,
  reactSide: 1,
  turn: 0,
  load: 0,
});

export const HIP_HEIGHT = 0.42;
const LOAD_Z = 0.36;
const TWO_PI = Math.PI * 2;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent approach toward a target. */
const damp = (from: number, to: number, rate: number, dt: number) =>
  from + (to - from) * (1 - Math.exp(-rate * dt));

/** A damped spring, sub-stepped so it stays stable on long frames. */
class Spring {
  x = 0;
  v = 0;
  constructor(
    private k: number,
    private c: number,
  ) {}
  step(target: number, dt: number) {
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (this.k * (target - this.x) - this.c * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  kick(v: number) {
    this.v += v;
  }
  reset() {
    this.x = 0;
    this.v = 0;
  }
}

const bindOf = (name: BoneName) =>
  (BONES.find((b) => b.name === name) as (typeof BONES)[number]).at;
const HIPS_BIND = bindOf("hips");
const restAngle = (from: BoneName, to: BoneName) => {
  const a = bindOf(from);
  const b = bindOf(to);
  return Math.atan2(-(b[2] - a[2]), -(b[1] - a[1]));
};
const THIGH_REST = restAngle("thighL", "shinL");
/** Seconds a shake-off lasts. */
const SHAKE_TIME = 0.95;
/** Brow height on the head bone, above the eyes. */
const BROW_Y = (EYES[0]?.[1] ?? 0) + 0.054 - bindOf("head")[1];
const SHIN_REST = restAngle("shinL", "footL");

export type BearTier = "high" | "low";
const SHELLS: Record<BearTier, number> = { high: 26, low: 12 };
const VOXELS: Record<BearTier, { base: number; shells: number }> = {
  high: { base: 0.0105, shells: 0.014 },
  low: { base: 0.013, shells: 0.018 },
};

function geometry(m: BodyMesh | PlainMesh) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
  if ("joints" in m) {
    g.setAttribute("skinIndex", new THREE.BufferAttribute(m.joints, 4));
    g.setAttribute("skinWeight", new THREE.BufferAttribute(m.weights, 4, true));
    g.setAttribute("fur", new THREE.BufferAttribute(m.fur, 4, true));
    g.setAttribute("comb", new THREE.BufferAttribute(m.comb, 3));
  }
  const n = m.positions.length / 3;
  g.setIndex(new THREE.BufferAttribute(n < 65536 ? Uint16Array.from(m.indices) : m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/** A sphere's upper cap, for eyelids. */
const lidGeometry = new THREE.SphereGeometry(EYE_RADIUS * 1.14, 24, 10, 0, TWO_PI, 0, 1.25);

function eyeTexture() {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    // Latitude bands from the front pole: pupil, iris with a warm rim, dark limbal ring, sclera.
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, "#020101");
    grad.addColorStop(0.12, "#040202");
    grad.addColorStop(0.14, "#2c170b");
    grad.addColorStop(0.24, "#5b3419");
    grad.addColorStop(0.29, "#2a160b");
    grad.addColorStop(0.32, "#120a06");
    grad.addColorStop(0.36, "#8a7560");
    grad.addColorStop(1, "#3a2c22");
    g.fillStyle = grad;
    g.fillRect(0, 0, 8, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Leathery nose: a fine cobblestone bump from a 3D cellular pattern, slightly moist. */
function leatherNose() {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x1d1512,
    roughness: 0.55,
    clearcoat: 0.35,
    clearcoatRoughness: 0.35,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vNosePos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvNosePos = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vNosePos;
float noseCells(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float best = 1.0;
  for (int x = -1; x <= 1; x++)
    for (int y = -1; y <= 1; y++)
      for (int z = -1; z <= 1; z++) {
        vec3 o = vec3(float(x), float(y), float(z));
        vec3 h = fract(sin(vec3(dot(i + o, vec3(127.1, 311.7, 74.7)), dot(i + o, vec3(269.5, 183.3, 246.1)), dot(i + o, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
        best = min(best, length(o + h - f));
      }
  return best;
}`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
{
  float bump = noseCells(vNosePos * 420.0);
  vec3 dx = dFdx(vViewPosition);
  vec3 dy = dFdy(vViewPosition);
  float hx = dFdx(bump);
  float hy = dFdy(bump);
  vec3 r1 = cross(dy, normal);
  vec3 r2 = cross(normal, dx);
  float det = dot(dx, r1);
  vec3 grad = sign(det) * (hx * r1 + hy * r2);
  normal = normalize(abs(det) * normal - grad * 0.0009);
}`,
      );
  };
  return m;
}

export class Bear {
  readonly root = (() => {
    const g = new THREE.Group();
    // Heading first, then pitch and roll in the bear's own frame: a trip pitches it onto its
    // face whichever way the trail runs.
    g.rotation.order = "YXZ";
    return g;
  })();
  /** Carries the pack and stack; rolled by the simulated tilt about the hips. */
  readonly load = new THREE.Group();
  /** Resolves when the furred body is in place. */
  readonly ready: Promise<void>;
  /** Visual gait phase, 0 … 2π per two steps (evidence captures may set it). */
  phase = 0;
  /** Called on every footfall: side (-1 left, 1 right) and how hard. */
  onFootfall: ((side: number, strength: number) => void) | null = null;
  /** World height of the ground at a point, so the feet plant on slopes. */
  ground: ((x: number, z: number) => number) | null = null;

  /** The body inflated to the fur's depth: casts the shadow and stands in for the fur in GTAO. */
  proxy: THREE.SkinnedMesh | null = null;

  private bone = new Map<BoneName, THREE.Bone>();
  private skeleton: THREE.Skeleton;
  private fur: FurLayers | null = null;
  private eyes: THREE.Mesh[] = [];
  private lids: THREE.Mesh[] = [];
  private brows: THREE.Mesh[] = [];
  private v = 0;
  private time = 0;
  private blinkIn = 1.5;
  private blinkT = -1;
  private lookIn = 2;
  private look = { yaw: 0, pitch: 0 };
  private earKick = 0;
  private lastU = [0, 0.5];
  private bounce = new Spring(260, 18);
  private bellyJiggle = new Spring(320, 9);
  private earSprings = [new Spring(170, 7), new Spring(170, 7)];
  private tailSpring = new Spring(140, 5);
  private headLag = { x: new Spring(220, 26), y: new Spring(220, 26) };
  private armSprings = [new Spring(150, 20), new Spring(150, 20)];
  private lastHipsY = 0;
  private lastHipsVel = 0;
  private lastYaw = 0;
  private motionReady = false;
  private target = new THREE.Vector3();
  private inverse = new THREE.Matrix4();
  private lifetime = new AbortController();
  private disposed = false;

  constructor(private tier: BearTier = "high") {
    const order: THREE.Bone[] = [];
    for (const def of BONES) {
      const b = new THREE.Bone();
      b.name = def.name;
      const parentAt = def.parent ? bindOf(def.parent) : [0, 0, 0];
      b.position.set(
        def.at[0] - (parentAt[0] as number),
        def.at[1] - (parentAt[1] as number),
        def.at[2] - (parentAt[2] as number),
      );
      (def.parent ? (this.bone.get(def.parent) as THREE.Bone) : this.root).add(b);
      this.bone.set(def.name, b);
      order.push(b);
    }
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(order);
    this.buildFace();
    this.buildPack();
    this.root.add(this.load);
    this.ready = this.build();
  }

  private b(name: BoneName) {
    return this.bone.get(name) as THREE.Bone;
  }

  /** Parents a root-space (bind pose) object to a bone. */
  private attach(name: BoneName, obj: THREE.Object3D, at: [number, number, number]) {
    const p = bindOf(name);
    obj.position.set(at[0] - p[0], at[1] - p[1], at[2] - p[2]);
    this.b(name).add(obj);
    return obj;
  }

  private buildFace() {
    const eyeMat = new THREE.MeshPhysicalMaterial({
      map: eyeTexture(),
      roughness: 0.55,
      clearcoat: 0.8,
      clearcoatRoughness: 0.03,
    });
    const eyeGeo = new THREE.SphereGeometry(EYE_RADIUS, 32, 24);
    // Put the texture's pole (the pupil) at the front of the eye.
    eyeGeo.rotateX(-Math.PI / 2);
    const lidMat = new THREE.MeshStandardMaterial({
      color: FUR_COLOURS.bodyRoot.clone().lerp(FUR_COLOURS.bodyTip, 0.35),
      roughness: 0.85,
    });
    for (const e of EYES) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.castShadow = false;
      this.attach("head", eye, e);
      this.eyes.push(eye);
      const lid = new THREE.Mesh(lidGeometry, lidMat);
      this.attach("head", lid, e);
      this.lids.push(lid);
      const brow = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.0078, 0.036, 4, 10),
        new THREE.MeshStandardMaterial({
          color: FUR_COLOURS.darkRoot.clone().lerp(FUR_COLOURS.darkTip, 0.5),
          roughness: 0.9,
        }),
      );
      brow.rotation.z = Math.PI / 2;
      this.attach("head", brow, [e[0] * 1.05, e[1] + 0.054, -0.176]);
      this.brows.push(brow);
    }
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x160d09, roughness: 0.7 });
    for (const line of MOUTH) {
      const curve = new THREE.CatmullRomCurve3(line.map((p) => new THREE.Vector3(...p)));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.0032, 6), mouthMat);
      this.attach("head", tube, [0, 0, 0]);
    }
  }

  private buildPack() {
    this.load.position.set(0, HIP_HEIGHT, LOAD_Z);
    const canvas = canvasCloth(0xb5552e);
    const part = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
    ) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.load.add(m);
      return m;
    };
    const ball = new THREE.SphereGeometry(1, 32, 24);
    part(ball, canvas, 0, 0.26, 0).scale.set(0.24, 0.26, 0.14);
    part(ball, canvasCloth(0x8a3d22), 0, 0.46, 0.01).scale.set(0.2, 0.08, 0.12);
    part(ball, canvas, 0, 0.16, 0.13).scale.set(0.15, 0.1, 0.06);
  }

  private async build() {
    const meshes = await loadBody(VOXELS[this.tier], this.lifetime.signal);
    if (this.disposed) return;
    const fur = buildFur(
      geometry(meshes.base),
      geometry(meshes.shells),
      this.skeleton,
      SHELLS[this.tier],
    );
    this.fur = fur;
    this.root.add(fur.base, ...fur.shells);
    // Shadows and the AO pre-pass see a body inflated to the fur's mid-depth, drawn nowhere else.
    const proxyGeo = geometry(meshes.shells);
    const pos = proxyGeo.getAttribute("position") as THREE.BufferAttribute;
    const nrm = proxyGeo.getAttribute("normal") as THREE.BufferAttribute;
    const furAttr = proxyGeo.getAttribute("fur") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const k = furAttr.getX(i) * 1.5 * furUniforms.uLength.value * 0.55;
      pos.setXYZ(
        i,
        pos.getX(i) + nrm.getX(i) * k,
        pos.getY(i) + nrm.getY(i) * k,
        pos.getZ(i) + nrm.getZ(i) * k,
      );
    }
    const proxy = new THREE.SkinnedMesh(
      proxyGeo,
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    );
    proxy.bind(this.skeleton, new THREE.Matrix4());
    proxy.castShadow = true;
    proxy.frustumCulled = false;
    this.root.add(proxy);
    this.proxy = proxy;

    const nose = new THREE.Mesh(geometry(meshes.nose), leatherNose());
    nose.castShadow = true;
    this.attach("head", nose, [0, 0, 0]);
  }

  /** Fur shells, for the AO pre-pass to skip (the proxy stands in for them). */
  get furMeshes(): THREE.Object3D[] {
    return this.fur ? [this.fur.base, ...this.fur.shells] : [];
  }

  /** Thins the fur for the adaptive quality step. Returns false when it cannot thin further. */
  thinFur() {
    if (!this.fur || this.fur.shells.length / (this.thinning + 1) < 8) return false;
    this.thinning++;
    this.fur.thin(this.thinning);
    return true;
  }
  private thinning = 1;
  private shakeT = -1;

  /** A replay starts with planted feet and no residual shake or spring impulses. */
  resetMotion() {
    this.shakeT = -1;
    this.earKick = 0;
    this.v = 0;
    this.lastU = [0, 0.5];
    this.phase = 0;
    for (const spring of [
      this.bounce,
      this.bellyJiggle,
      this.tailSpring,
      this.headLag.x,
      this.headLag.y,
      ...this.earSprings,
      ...this.armSprings,
    ])
      spring.reset();
    this.lastHipsY = this.lastHipsVel = this.lastYaw = 0;
    this.motionReady = false;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.lifetime.abort();
    this.onFootfall = this.ground = null;
  }

  bump(strength = 1) {
    this.earKick = Math.min(1.4, this.earKick + strength);
    this.bounce.kick(-0.9 * strength);
    this.bellyJiggle.kick(-0.6 * strength);
    for (const s of this.earSprings) s.kick(4 * strength);
  }

  /** Starts a shake-off: the upper body twists hard for under a second, like a wet dog. */
  shake() {
    if (this.shakeT < 0 || this.shakeT > SHAKE_TIME) this.shakeT = 0;
  }

  /** 0 … 1 while a shake is under way (for spray), else 0. */
  get shaking() {
    return this.shakeT >= 0 && this.shakeT < SHAKE_TIME
      ? Math.sin((Math.PI * this.shakeT) / SHAKE_TIME)
      : 0;
  }

  /** World position of a point given in the bind pose, carried by a bone. */
  pointOn(name: BoneName, at: [number, number, number], out: THREE.Vector3) {
    const b = bindOf(name);
    return this.b(name).localToWorld(out.set(at[0] - b[0], at[1] - b[1], at[2] - b[2]));
  }

  update(p: BearPose, dt: number, calm: boolean) {
    this.time += dt;
    const t = this.time;
    const amp = calm ? 0.45 : 1;
    // Evidence captures freeze time: take the pose's speed as it is.
    this.v = dt === 0 ? p.speed : damp(this.v, p.speed, 7, dt);
    const v = this.v;
    const walk = smooth(0.02, 0.45, v) * (1 - p.sit) * (1 - p.flop);
    const run = smooth(1.35, 1.95, v);
    const load = clamp(p.load, 0, 1);
    const stepLen = mix(0.26, 0.44, clamp((v - 0.3) / 1.5, 0, 1));
    if (v > 0.01) this.phase = (this.phase + (dt * Math.PI * v) / stepLen) % TWO_PI;
    const duty = mix(0.6, 0.42, run);
    const stride = Math.min(2 * duty * stepLen, 0.34);
    const lift = mix(0.045, 0.085, run) * (1 - 0.35 * load);

    // ---- pelvis: bob, weight shift, roll and turn ------------------------------------------------
    const hips = this.b("hips");
    const midStance = this.phase - Math.PI * duty;
    const bobWalk = -0.022 * (0.5 + 0.5 * Math.cos(2 * this.phase));
    const bobRun = -0.034 * (0.5 + 0.5 * Math.cos(2 * midStance));
    const bob = mix(bobWalk, bobRun, run) * walk * amp;
    const idle = 1 - smooth(0.02, 0.3, v);
    const sway =
      -Math.cos(midStance) * (0.03 + 0.02 * load) * walk * amp +
      Math.sin(t * 0.9) * 0.012 * idle * (1 - p.sit) * amp;
    const crouch = (0.02 + 0.025 * run + 0.04 * load) * (1 - p.sit);
    const settle = this.bounce.step(0, dt);
    const hipsY = mix(HIPS_BIND[1] - crouch + bob + settle, 0.2, p.sit);
    hips.position.set(sway - p.lean * 0.05, hipsY, HIPS_BIND[2]);
    const yaw = Math.sin(this.phase) * 0.09 * walk * amp;
    const roll = Math.cos(midStance) * 0.05 * walk * amp;
    const pelvisPitch = -0.04 * walk - 0.05 * load * walk + p.sit * 0.25;
    hips.rotation.set(pelvisPitch, yaw, roll);

    // Vertical motion drives the soft parts: a spring each for the belly, ears and head.
    const hipsVel = dt > 0 && this.motionReady ? (hipsY - this.lastHipsY) / dt : 0;
    const hipsAcc = dt > 0 && this.motionReady ? (hipsVel - this.lastHipsVel) / dt : 0;
    this.lastHipsY = hipsY;
    this.lastHipsVel = hipsVel;
    const yawVel = dt > 0 && this.motionReady ? (yaw - this.lastYaw) / dt : 0;
    this.lastYaw = yaw;
    this.motionReady = true;

    // ---- footfalls -------------------------------------------------------------------------------
    for (let i = 0; i < 2; i++) {
      const u = (this.phase / TWO_PI + (i === 0 ? 0 : 0.5)) % 1;
      const last = this.lastU[i] as number;
      if (walk > 0.3 && u < last && dt > 0) {
        const strength = clamp(v / 1.8, 0.2, 1) * (0.8 + 0.4 * load);
        this.bounce.kick(-0.35 * strength * amp);
        this.bellyJiggle.kick(-0.9 * strength * amp);
        this.onFootfall?.(i === 0 ? -1 : 1, strength);
      }
      this.lastU[i] = u;
    }

    // ---- torso: forward lean under load, shoulders counter-rotate, lean into the balance --------
    const spine = this.b("spine");
    const chest = this.b("chest");
    const forward = (0.05 + 0.09 * run + 0.08 * load) * walk;
    // A bear's waddle: the upper body tips over the stance leg, against the pelvis.
    const waddle = Math.cos(midStance) * (0.05 + 0.03 * load) * walk * amp;
    spine.rotation.set(
      -forward + p.sit * 0.12,
      -yaw * 0.5,
      -p.lean * 0.24 - p.tilt * 0.25 + waddle,
    );
    const breathe = calm ? 0 : Math.sin(t * (2.1 + 1.5 * run)) * (0.012 + 0.02 * run);
    chest.rotation.set(breathe - p.sit * 0.05, -yaw * 0.9, roll * -0.4);

    // Shake-off: the chest whips round against the head at about seven and a half twists a
    // second, the arms fly out and everything soft keeps swinging after.
    let shake = 0;
    if (this.shakeT >= 0) {
      this.shakeT += dt;
      const env =
        this.shakeT < SHAKE_TIME ? Math.sin((Math.PI * this.shakeT) / SHAKE_TIME) ** 0.7 : 0;
      shake = Math.sin(this.shakeT * Math.PI * 15) * env * (calm ? 0.35 : 1);
      spine.rotation.y += shake * 0.16;
      chest.rotation.y += shake * 0.3;
      if (env > 0) {
        this.bellyJiggle.kick(shake * 0.4);
        for (const s of this.earSprings) s.kick(shake * 1.5);
      }
      if (this.shakeT > SHAKE_TIME + 0.2) this.shakeT = -1;
    }

    // ---- head: steadier than the body, glancing at the load, bowing, looking around -------------
    this.lookIn -= dt;
    if (this.lookIn < 0) {
      this.lookIn = 1.8 + ((t * 7.31) % 3.2);
      const r1 = Math.sin(t * 12.9898) * 43758.5453;
      const r2 = Math.sin(t * 78.233) * 12543.1234;
      this.look.yaw = (r1 - Math.floor(r1) - 0.5) * (0.9 * idle + 0.35 * walk);
      this.look.pitch = (r2 - Math.floor(r2) - 0.5) * 0.25;
    }
    const glance = p.alarm;
    const neck = this.b("neck");
    const head = this.b("head");
    neck.rotation.set(forward * 0.55 + 0.04 * walk - bob * 1.5, yaw * 0.4, -p.tilt * 0.15);
    const hx =
      glance * 0.55 - p.bow * 0.45 - p.react * 0.35 + this.look.pitch * (1 - glance) + settle * 1.2;
    const hy =
      -p.alarmSide * glance * 0.5 -
      p.reactSide * p.react * 0.9 +
      this.look.yaw * (1 - glance) * (1 - p.react);
    head.rotation.set(
      this.headLag.x.step(hx, dt),
      this.headLag.y.step(hy, dt) - shake * 0.45,
      p.alarmSide * glance * 0.12 - roll * 0.5 + shake * 0.12,
    );

    // ---- eyes: blink, and lead the head's glances --------------------------------------------------
    this.blinkIn -= dt;
    if (this.blinkIn < 0 && this.blinkT < 0) {
      this.blinkT = 0;
      this.blinkIn = 2 + ((t * 7.3) % 3) + (Math.sin(t * 3.7) > 0.7 ? -1.8 : 0);
    }
    let closed = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const b = this.blinkT;
      closed = b < 0.07 ? b / 0.07 : b < 0.11 ? 1 : Math.max(0, 1 - (b - 0.11) / 0.12);
      if (b > 0.23) this.blinkT = -1;
    }
    const wide = glance * 0.35 + p.react * 0.4;
    const lidOpen = 0.8 + wide * 0.25;
    const lidShut = -1.35;
    const lidAngle = mix(lidOpen, lidShut, Math.max(closed, p.bow > 0.5 ? 0.75 : 0.18 * load));
    for (const lid of this.lids) lid.rotation.x = lidAngle;
    for (let i = 0; i < 2; i++) {
      const eye = this.eyes[i] as THREE.Mesh;
      eye.rotation.set(
        glance * 0.35 + this.look.pitch * 0.6 - p.bow * 0.3,
        (hy - head.rotation.y) * 0.8 + this.look.yaw * 0.3,
        0,
      );
      const brow = this.brows[i] as THREE.Mesh;
      const s = i === 0 ? 1 : -1;
      brow.position.y = BROW_Y + glance * 0.012 - p.bow * 0.006;
      brow.rotation.set(0, 0, Math.PI / 2 + s * (glance * 0.35 + p.react * 0.3 - p.bow * 0.3));
    }

    // ---- ears: springs on the body's bounce, a flick on bumps --------------------------------------
    this.earKick = Math.max(0, this.earKick - dt * 2.5);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const spring = this.earSprings[i] as Spring;
      const flop = spring.step(clamp(-hipsAcc * 0.012, -0.6, 0.6) * amp, dt);
      const flick = calm ? 0 : Math.sin(t * 30) * this.earKick * 0.3;
      this.b(i === 0 ? "earL" : "earR").rotation.set(
        -glance * 0.4 + flick + flop,
        0,
        s * (0.08 + glance * 0.3 - flop * 0.3),
      );
    }

    // ---- belly and tail ------------------------------------------------------------------------------
    const belly = this.b("belly");
    const jiggle = this.bellyJiggle.step(0, dt);
    belly.position.y = bindOf("belly")[1] - bindOf("spine")[1] + jiggle * 0.03;
    const breath = calm ? 1 : 1 + Math.sin(t * (2.1 + 1.5 * run)) * (0.012 + 0.02 * run);
    belly.scale.set(breath, breath, breath);
    this.b("tail").rotation.set(0.2 * walk, this.tailSpring.step(-yawVel * 0.08, dt) * amp, 0);

    // ---- arms: swing against the legs; reach up to steady the load; rest in the lap to sit -------
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const reach = Math.max(0, side * p.alarmSide) * p.alarm;
      // The opposite leg's foot position drives this arm (contralateral swing).
      const u = (this.phase / TWO_PI + (i === 0 ? 0.5 : 0)) % 1;
      const footZ =
        u < duty ? mix(-0.5, 0.5, u / duty) : mix(0.5, -0.5, smooth(0, 1, (u - duty) / (1 - duty)));
      const swing = this.armSprings[i]?.step(-footZ * (0.8 + 0.4 * run) * walk * amp, dt) ?? 0;
      const upper = this.b(i === 0 ? "armL" : "armR");
      const fore = this.b(i === 0 ? "foreArmL" : "foreArmR");
      upper.rotation.set(
        swing * (1 - reach) * (1 - p.air) +
          reach * 0.5 +
          p.sit * 0.75 -
          p.air * 1.1 -
          p.flop * p.flopForward * 1.5,
        0,
        side *
          (0.14 +
            Math.abs(shake) * 0.6 +
            0.12 * run +
            0.1 * load +
            Math.abs(swing) * 0.15 +
            reach * 2.2 +
            p.alarm * 0.12 +
            p.react * 1.8 +
            p.air * 0.7 +
            p.flop * 0.7 * (1 - p.flopForward)),
      );
      fore.rotation.set(
        0.25 + 0.55 * run + Math.max(0, swing) * 0.35 + reach * 0.7 + p.sit * 0.6,
        0,
        0,
      );
    }

    // ---- legs: planted feet through two-bone IK; stretched out to sit; splayed in a topple ---------
    hips.updateMatrix();
    this.inverse.copy(hips.matrix).invert();
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const u = (this.phase / TWO_PI + (i === 0 ? 0 : 0.5)) % 1;
      let z: number;
      let y = 0;
      let pitch: number;
      if (u < duty) {
        const s = u / duty;
        z = mix(-stride / 2, stride / 2, s);
        pitch = s < 0.15 ? mix(0.3, 0, s / 0.15) : s > 0.7 ? mix(0, -0.55, (s - 0.7) / 0.3) : 0;
      } else {
        const s = (u - duty) / (1 - duty);
        z = mix(stride / 2, -stride / 2, smooth(0, 1, s));
        y = lift * Math.sin(Math.PI * Math.min(1, s * 1.08)) ** 0.9;
        pitch = mix(-0.55, 0.3, smooth(0.1, 0.9, s));
      }
      z *= walk;
      y *= walk;
      pitch *= walk;
      const rest = side * 0.012 * idle;
      // Sitting: the feet slide forward along the ground and the toes turn up.
      const heel = Math.max(0, -pitch) * 0.075;
      // Where the ground really is under this foot (a hillside, a log's slope), relative to the
      // bear's root; only while standing.
      let ground = 0;
      if (this.ground && p.air < 0.5 && p.flop < 0.05) {
        const yaw = this.root.rotation.y;
        const lx = side * 0.125;
        const px = this.root.position.x + lx * Math.cos(yaw) + z * Math.sin(yaw);
        const pz = this.root.position.z - lx * Math.sin(yaw) + z * Math.cos(yaw);
        ground = clamp(this.ground(px, pz) - this.root.position.y, -0.12, 0.12);
      }
      this.target.set(
        mix(side * 0.125, side * 0.14, p.sit),
        mix(ANKLE + y + heel + ground * (1 - p.air), ANKLE * 0.8, p.sit) + p.air * 0.16,
        mix(z - 0.01 + rest, -0.36, p.sit) - p.air * (i === 0 ? 0.08 : -0.06),
      );
      const footPitch = mix(pitch, 0.9, p.sit) + p.air * 0.5;
      this.solveLeg(i, footPitch, pelvisPitch, p.flop, side);
    }

    // ---- the load follows the body's bounce and the simulated tilt exactly -------------------------
    this.load.position.set(
      sway * 0.8 - p.lean * 0.05,
      HIP_HEIGHT + bob + settle - p.sit * 0.2,
      LOAD_Z,
    );
    this.load.rotation.set(0, -yaw * 0.4, -p.tilt);

    // A topple rolls the whole bear onto its side; a trip pitches it onto its face.
    this.root.rotation.z = -p.flopSide * p.flop * 1.35 * (1 - p.flopForward);
    this.root.rotation.x = -p.flop * p.flopForward * 1.3;
  }

  /** Two-bone IK: thigh and shin reach the ankle target (root space), the foot takes `pitch`. */
  private solveLeg(i: number, pitch: number, pelvisPitch: number, flop: number, side: number) {
    const thigh = this.b(i === 0 ? "thighL" : "thighR");
    const shin = this.b(i === 0 ? "shinL" : "shinR");
    const foot = this.b(i === 0 ? "footL" : "footR");
    const d = this.target.applyMatrix4(this.inverse).sub(thigh.position);
    const L = clamp(d.length(), Math.abs(THIGH - SHIN) + 1e-3, THIGH + SHIN - 1e-3);
    const theta = Math.atan2(-d.z, -d.y);
    const roll = Math.atan2(d.x, -d.y);
    const beta = Math.acos(clamp((THIGH * THIGH + L * L - SHIN * SHIN) / (2 * THIGH * L), -1, 1));
    const knee =
      Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - L * L) / (2 * THIGH * SHIN), -1, 1));
    const thighX = mix(theta + beta - THIGH_REST, 0.5, flop);
    const shinX = mix(-knee - (SHIN_REST - THIGH_REST), -0.6, flop);
    thigh.rotation.set(thighX, 0, mix(roll, side * 0.35, flop), "ZXY");
    shin.rotation.set(shinX, 0, 0);
    // Rotations compose along the chain; the foot's own rest orientation is flat.
    foot.rotation.set(pitch - pelvisPitch - thighX - shinX, 0, -roll * (1 - flop));
  }
}
