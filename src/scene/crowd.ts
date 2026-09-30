import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clone as cloneRig } from "three/examples/jsm/utils/SkeletonUtils.js";
import { CROWD, walkerAt } from "../game/obstacles";
import { type PathPoint, pointAt } from "../game/trail";
import { SceneAssets } from "./assets";

// The village green's crowd: fourteen villagers (Quaternius, CC0) crossing and strolling with
// their eyes on their phones. Each stands exactly where the rules put them (walkerAt, on the
// run's own clock), walks or idles on the shared clips, holds a glowing phone up in front of
// their chest (a two-bone reach solved each frame, whatever the rig's bone axes), and bows their
// head to it. A bump plays a stagger and a glance up.

const LOOKS = [
  "m_Casual_Hoodie",
  "w_Casual",
  "m_Suit",
  "w_Formal",
  "m_Punk",
  "w_Punk",
  "m_Worker",
  "w_Worker",
  "m_Farmer",
  "w_Adventurer",
  "m_Beach",
  "w_Suit",
  "m_Adventurer",
  "m_Casual_2",
];
/** Adult heights (m): a little variety; all tower over the bear. */
const HEIGHTS = [1.78, 1.64, 1.83, 1.68, 1.74, 1.6, 1.8, 1.66, 1.76, 1.62, 1.72, 1.7, 1.81, 1.75];

interface Villager {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  walk: THREE.AnimationAction;
  idle: THREE.AnimationAction;
  hit: THREE.AnimationAction;
  upper: THREE.Bone | null;
  lower: THREE.Bone | null;
  wrist: THREE.Bone | null;
  neck: THREE.Bone | null;
  head: THREE.Bone | null;
  phone: THREE.Group;
  yaw: number;
  moving: number;
  /** Seconds since a bump (the phone drops away from the face for a moment). */
  startled: number;
}

const tmp = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  c: new THREE.Vector3(),
  d: new THREE.Vector3(),
  e: new THREE.Vector3(),
  q: new THREE.Quaternion(),
  q2: new THREE.Quaternion(),
  m: new THREE.Matrix4(),
};

/** Rotate a bone (in world space) so that `from` points along `to`. */
function aim(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3, amount = 1) {
  const delta = tmp.q.setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
  if (amount < 1) delta.slerp(tmp.q2.identity(), 1 - amount);
  const world = bone.getWorldQuaternion(new THREE.Quaternion());
  const parent = bone.parent
    ? bone.parent.getWorldQuaternion(new THREE.Quaternion())
    : new THREE.Quaternion();
  bone.quaternion.copy(parent.invert().multiply(delta).multiply(world));
  bone.updateMatrixWorld(true);
}

function makePhone() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.075, 0.15, 0.009),
    new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.35, metalness: 0.4 }),
  );
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.066, 0.138),
    new THREE.MeshStandardMaterial({
      color: 0x0b1320,
      emissive: 0x9fd4ff,
      emissiveIntensity: 0.9,
      roughness: 0.2,
    }),
  );
  screen.position.z = 0.0048;
  g.add(body, screen);
  return g;
}

/** One material for the whole crowd: the models' flat colours become vertex colours. */
const folkMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.5,
  metalness: 0,
});

/** A float copy of one of the geometry's attributes (the models' are quantized). */
function floats(geometry: THREE.BufferGeometry, name: string) {
  const source = geometry.getAttribute(name);
  if (!source) return null;
  const size = source.itemSize;
  const out = new Float32Array(source.count * size);
  for (let i = 0; i < source.count; i++)
    for (let c = 0; c < size; c++) out[i * size + c] = source.getComponent(i, c);
  return new THREE.BufferAttribute(out, size);
}

/**
 * A villager's dozen flat-coloured parts as one skinned mesh (one draw per pass instead of a
 * dozen), their colours baked into the vertices. The parts share one skeleton; a part bound in
 * another frame (its inverse bind matrices all offset by one transform) is moved into the
 * first part's frame. Where each part sits in the model does not matter: attached skinning
 * cancels the mesh's own transform. Leaves the model as it is if the parts cannot share one
 * skeleton.
 */
function mergeParts(model: THREE.Object3D) {
  const parts: THREE.SkinnedMesh[] = [];
  model.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) parts.push(o as THREE.SkinnedMesh);
  });
  const first = parts[0];
  if (!first?.parent || parts.length < 2) return;
  const ref = first.skeleton;
  const toFirst = first.bindMatrix.clone().invert();
  const geometries: THREE.BufferGeometry[] = [];
  const check = new THREE.Matrix4();
  for (const part of parts) {
    const { skeleton, geometry } = part;
    const material = part.material as THREE.MeshStandardMaterial;
    if (
      Array.isArray(part.material) ||
      Object.keys(geometry.morphAttributes).length ||
      skeleton.bones.length !== ref.bones.length ||
      skeleton.bones.some((bone, k) => bone !== ref.bones[k])
    )
      return;
    const offset = (ref.boneInverses[0] as THREE.Matrix4)
      .clone()
      .invert()
      .multiply(skeleton.boneInverses[0] as THREE.Matrix4);
    for (let k = 0; k < skeleton.bones.length; k++) {
      check.multiplyMatrices(ref.boneInverses[k] as THREE.Matrix4, offset);
      const want = (skeleton.boneInverses[k] as THREE.Matrix4).elements;
      if (
        check.elements.some((e, i) => Math.abs(e - (want[i] as number)) > 1e-4 * (1 + Math.abs(e)))
      )
        return;
    }
    const merged = new THREE.BufferGeometry();
    for (const name of ["position", "normal", "skinIndex", "skinWeight"]) {
      const a = floats(geometry, name);
      if (!a) return;
      merged.setAttribute(name, a);
    }
    const n = geometry.getAttribute("position").count;
    const colour = material.color ?? new THREE.Color(1, 1, 1);
    const colours = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colour.toArray(colours, i * 3);
    merged.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    if (geometry.index) merged.setIndex(geometry.index.clone());
    merged.applyMatrix4(toFirst.clone().multiply(offset).multiply(part.bindMatrix));
    geometries.push(merged);
  }
  const geometry = mergeGeometries(geometries);
  if (!geometry) return;
  const mesh = new THREE.SkinnedMesh(geometry, folkMaterial);
  mesh.name = "villager";
  mesh.position.copy(first.position);
  mesh.quaternion.copy(first.quaternion);
  mesh.scale.copy(first.scale);
  first.parent.add(mesh);
  mesh.bind(ref, first.bindMatrix);
  for (const part of parts) part.removeFromParent();
}

export class Crowd {
  readonly group = new THREE.Group();
  readonly ready: Promise<void>;
  private folk: Villager[] = [];
  private disposed = false;

  constructor(
    private path: readonly PathPoint[],
    private ground: (x: number, z: number) => number,
    private calm: boolean,
    private assets = new SceneAssets(),
  ) {
    this.group.name = "crowd";
    this.ready = this.load();
    if (import.meta.env.DEV) (window as unknown as { __CROWD__: Crowd }).__CROWD__ = this;
  }

  private async load() {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const base = `${import.meta.env.BASE_URL}models/people/`;
    const load = (url: string) =>
      this.assets.wait(
        loader.loadAsync(url).then((gltf) => {
          this.assets.resources.tree(gltf.scene);
          this.assets.assertAlive();
          return gltf;
        }),
      );
    const [anims, ...models] = await Promise.all([
      load(`${base}anims.glb`),
      ...LOOKS.map((n) => load(`${base}${n}.glb`)),
    ]);
    if (this.disposed) return;
    const clip = (name: string) =>
      anims.animations.find((a) => a.name === name) as THREE.AnimationClip;
    for (const m of models) mergeParts(m.scene);
    for (const m of models) this.assets.resources.tree(m.scene);
    CROWD.forEach((w, i) => {
      const src = models[w.look % models.length];
      if (!src) return;
      const root = cloneRig(src.scene);
      const skins: THREE.SkinnedMesh[] = [];
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
          if ((m as THREE.SkinnedMesh).isSkinnedMesh) skins.push(m as THREE.SkinnedMesh);
        }
      });
      // Scale to an adult's height from the bind pose.
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root, true);
      const tall = Math.max(0.01, box.max.y - box.min.y);
      root.scale.multiplyScalar((HEIGHTS[i % HEIGHTS.length] as number) / tall);
      // Culled like anything else, in a sphere taken from the bind pose with room for a
      // stagger or an outstretched arm (it is never recomputed).
      root.updateMatrixWorld(true);
      for (const m of skins) {
        m.computeBoundingSphere();
        (m.boundingSphere as THREE.Sphere).radius *= 1.3;
      }
      // The pose offsets below are in metres for a 1.75 m adult.
      root.userData.baseScale = root.scale.x * (1.75 / (HEIGHTS[i % HEIGHTS.length] as number));
      const bone = (name: string) => (root.getObjectByName(name) as THREE.Bone | undefined) ?? null;
      const mixer = new THREE.AnimationMixer(root);
      const walk = mixer.clipAction(clip("Walk"));
      const idle = mixer.clipAction(clip("Idle_Neutral") ?? clip("Idle"));
      const hit = mixer.clipAction(clip("HitRecieve"));
      hit.setLoop(THREE.LoopOnce, 1);
      hit.clampWhenFinished = false;
      walk.play();
      idle.play();
      walk.time = (i * 0.37) % walk.getClip().duration;
      idle.time = (i * 0.53) % idle.getClip().duration;
      const phone = makePhone();
      this.group.add(root, phone);
      this.folk.push({
        root,
        mixer,
        walk,
        idle,
        hit,
        upper: bone("UpperArmR"),
        lower: bone("LowerArmR"),
        wrist: bone("WristR"),
        neck: bone("Neck"),
        head: bone("Head"),
        phone,
        yaw: 0,
        moving: 0,
        startled: 99,
      });
    });
    this.assets.resources.tree(this.group);
  }

  setCalm(calm: boolean) {
    this.calm = calm;
  }

  reset() {
    for (const villager of this.folk) {
      villager.startled = 99;
      villager.hit.stop();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const villager of this.folk) {
      villager.mixer.stopAllAction();
      villager.mixer.uncacheRoot(villager.root);
    }
    this.folk = [];
    const debug = window as unknown as { __CROWD__?: Crowd };
    if (debug.__CROWD__ === this) delete debug.__CROWD__;
  }

  /** A walker the bear bumped into: stagger, look up, then back to the phone. */
  bump(who: number) {
    const v = this.folk[who];
    if (!v) return;
    v.startled = 0;
    v.hit.reset().setEffectiveWeight(1).fadeIn(0.08).play();
  }

  /** Where walker `who` stands (world), for toasts and sounds. */
  position(who: number, out = new THREE.Vector3()) {
    const v = this.folk[who];
    return v ? out.copy(v.root.position) : out.set(0, 0, 0);
  }

  update(time: number, dt: number) {
    CROWD.forEach((w, i) => {
      const v = this.folk[i];
      if (!v) return;
      const p = walkerAt(w, time);
      const pt = pointAt(this.path, p.d);
      const rx = Math.cos(pt.heading);
      const rz = -Math.sin(pt.heading);
      const fx = -Math.sin(pt.heading);
      const fz = -Math.cos(pt.heading);
      const x = pt.x + rx * p.x;
      const z = pt.z + rz * p.x;
      v.root.position.set(x, this.ground(x, z), z);
      const dx = fx * Math.cos(p.heading) + rx * Math.sin(p.heading);
      const dz = fz * Math.cos(p.heading) + rz * Math.sin(p.heading);
      const target = Math.atan2(dx, dz);
      let diff = target - v.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      v.yaw += diff * Math.min(1, dt * 6);
      v.root.rotation.y = v.yaw;
      v.moving += ((p.moving ? 1 : 0) - v.moving) * Math.min(1, dt * 5);
      v.walk.setEffectiveWeight(v.moving);
      v.idle.setEffectiveWeight(1 - v.moving);
      // Phone-walking pace: a shuffle, not a stride.
      v.walk.timeScale = 0.72;
      v.startled += dt;
      v.mixer.update(this.calm ? dt * 0.8 : dt);
      v.root.updateMatrixWorld(true);
      this.pose(v);
    });
  }

  /** Raise the phone to the chest and bow the head to it (after the clip has posed the rig). */
  private pose(v: Villager) {
    if (!v.upper || !v.lower || !v.wrist || !v.head) return;
    const up = Math.min(1, Math.max(0, (v.startled - 0.5) / 0.6));
    const fwd = tmp.a.set(Math.sin(v.yaw), 0, Math.cos(v.yaw));
    const right = tmp.b.set(Math.cos(v.yaw), 0, -Math.sin(v.yaw));
    const S = v.upper.getWorldPosition(new THREE.Vector3());
    const E = v.lower.getWorldPosition(new THREE.Vector3());
    const H = v.wrist.getWorldPosition(new THREE.Vector3());
    const a = S.distanceTo(E);
    const b = E.distanceTo(H);
    const L = a + b;
    // The phone, in arm lengths from the shoulder: half an arm forward, well below, drawn in
    // toward the body (these stylised folk have short arms). Lowered for a moment after a bump.
    const target = S.clone()
      .addScaledVector(fwd, (0.5 * up + 0.12 * (1 - up)) * L)
      .addScaledVector(right, -(0.28 * up + 0.05 * (1 - up)) * L);
    target.y -= (0.42 * up + 0.86 * (1 - up)) * L;
    const toT = target.clone().sub(S);
    const d = Math.min(toT.length(), L * 0.999);
    const dir = toT.clone().normalize();
    // Elbow: down and a little out, as when reading.
    const pole = new THREE.Vector3(0, -1, 0).addScaledVector(right, 0.5).normalize();
    const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    const side = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
    const elbow = S.clone()
      .addScaledVector(dir, a * cosA)
      .addScaledVector(side, a * sinA);
    aim(v.upper, E.clone().sub(S), elbow.clone().sub(S));
    const E2 = v.lower.getWorldPosition(new THREE.Vector3());
    const H2 = v.wrist.getWorldPosition(new THREE.Vector3());
    aim(v.lower, H2.clone().sub(E2), S.clone().addScaledVector(dir, d).sub(E2));
    // Head: bowed to the screen (lifted for a moment after a bump).
    const eyes = v.head.getWorldPosition(new THREE.Vector3());
    const hand = v.wrist.getWorldPosition(new THREE.Vector3());
    const look = hand.clone().sub(eyes).normalize();
    if (v.neck) aim(v.neck, fwd, look, 0.22 * up);
    aim(v.head, fwd, look, 0.3 * up);
    // The phone in the hand, screen to the face.
    v.phone.position
      .copy(hand)
      .addScaledVector(fwd, 0.035)
      .add(new THREE.Vector3(0, 0.03, 0));
    v.phone.lookAt(v.head.getWorldPosition(new THREE.Vector3()));
    const k = v.root.scale.x / (v.root.userData.baseScale as number);
    v.phone.scale.setScalar(k);
  }
}
