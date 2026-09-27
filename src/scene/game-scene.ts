import gsap from "gsap";
import * as THREE from "three";
import type { ItemId } from "../game/items";
import { layoutStack } from "../game/load";
import type { RunEvent, RunState } from "../game/run";
import type { TeaOutcome } from "../game/tea";
import {
  CHECKPOINTS,
  gustAt,
  LEDGE,
  type PathPoint,
  pointAt,
  samplePath,
  TRAIL_LENGTH,
} from "../game/trail";
import { Bear, restPose } from "./bear";
import { CameraRig } from "./camera";
import { buildDressing, windUniforms } from "./dressing";
import { PALETTE } from "./materials";
import { buildProp } from "./props";
import { Spills } from "./spills";
import { Stage } from "./stage";
import { TeaScene } from "./tea";
import { buildSky, buildTerrain, buildTrail, Ground } from "./terrain";

// Turns the rules' state into the picture each frame: places the bear on the trail, mirrors
// the simulated stack, throws spills, plays topples and lays out the tea.

const FLOP_DOWN = 0.9;

export class GameScene {
  readonly stage: Stage;
  private path: PathPoint[];
  private ground: Ground;
  private bear = new Bear();
  private rig: CameraRig;
  private spills: Spills;
  private tea = new TeaScene();
  private flags: THREE.Mesh[];
  private stackMeshes = new Map<ItemId, THREE.Group>();
  private pose = restPose();
  private flop: { t: number; fromD: number; side: number } | null = null;
  private lastD = 0;
  private teaTime = -1;
  private seat = 0;
  private silence = false;
  private hush = 0;

  constructor(
    canvas: HTMLCanvasElement,
    mobile: boolean,
    private calm: boolean,
  ) {
    this.stage = new Stage(canvas, mobile);
    this.path = samplePath();
    this.ground = new Ground(this.path);
    const { scene } = this.stage;
    scene.add(buildSky());
    scene.add(buildTerrain(this.ground, new THREE.Vector2(-18, 24), 150, mobile ? 130 : 180));
    scene.add(buildTrail(this.path, TRAIL_LENGTH));
    const dressing = buildDressing(this.ground, this.path, mobile);
    scene.add(dressing.group);
    this.flags = dressing.flags;
    this.spills = new Spills(this.ground);
    scene.add(this.spills.group, this.bear.root, this.tea.group);
    this.rig = new CameraRig(this.stage.camera, this.path);
    windUniforms.uSway.value = calm ? 0.25 : 1;
  }

  /** Back to the trailhead for a new run. */
  reset() {
    this.spills.clear();
    this.tea.clear();
    this.flop = null;
    this.teaTime = -1;
    this.silence = false;
    this.pose = restPose();
    this.bear.load.visible = true;
    for (const f of this.flags) (f.material as THREE.MeshStandardMaterial).color.set(0x8a8070);
    this.rig.snap();
  }

  handle(events: RunEvent[], s: RunState) {
    for (const e of events) {
      if (e.type === "drop") {
        const mesh = this.stackMeshes.get(e.id);
        if (!mesh) continue;
        this.stackMeshes.delete(e.id);
        this.spills.drop(e.id, mesh, this.rightAt(s.d).multiplyScalar(e.side), this.calm);
        this.bear.bump(0.8);
      } else if (e.type === "fetch") {
        this.spills.take(e.id);
        this.bear.bump(1);
      } else if (e.type === "topple") {
        this.flop = { t: 0, fromD: this.lastD, side: e.side };
        const p = pointAt(this.path, this.lastD);
        this.spills.puff(new THREE.Vector3(p.x, p.y, p.z), 10);
      } else if (e.type === "log") {
        this.bear.bump(1);
      } else if (e.type === "checkpoint") {
        const i = CHECKPOINTS.indexOf(e.at) - 1;
        const flag = this.flags[i];
        if (flag) {
          (flag.material as THREE.MeshStandardMaterial).color.set(PALETTE.mustard);
          if (!this.calm)
            gsap.fromTo(
              flag.scale,
              { y: 0.2 },
              { y: 1, duration: 0.5, ease: "elastic.out(1, 0.4)" },
            );
        }
      }
    }
  }

  arrive(outcome: TeaOutcome) {
    this.seat = this.tea.build(outcome, this.calm);
    this.silence = outcome.silence;
    this.teaTime = 0;
    this.bear.load.visible = false;
    for (const m of this.stackMeshes.values()) this.bear.load.remove(m);
    this.stackMeshes.clear();
  }

  private rightAt(d: number) {
    const h = pointAt(this.path, d).heading;
    return new THREE.Vector3(Math.cos(h), 0, -Math.sin(h));
  }

  private syncStack(s: RunState) {
    if (s.phase === "tea") return;
    for (const [id, mesh] of this.stackMeshes) {
      if (!s.stack.includes(id)) {
        this.bear.load.remove(mesh);
        this.stackMeshes.delete(id);
      }
    }
    const layout = layoutStack(s.stack);
    layout.forEach((entry, i) => {
      let mesh = this.stackMeshes.get(entry.id);
      if (!mesh) {
        mesh = buildProp(entry.id);
        this.stackMeshes.set(entry.id, mesh);
        this.bear.load.add(mesh);
        if (!this.calm)
          gsap.from(mesh.scale, { x: 0.3, y: 0.3, z: 0.3, duration: 0.35, ease: "back.out(2.5)" });
      }
      const slide = s.slides[i] ?? 0;
      const rattle = Math.sin(s.stepPhase * 2 + i * 1.7) * 0.006 * Math.min(1, s.speed);
      mesh.position.set(slide * 0.3, entry.bottom + Math.abs(rattle), 0);
      mesh.rotation.set(0, 0, -slide * 0.3 + rattle);
    });
    // Spills that the rules no longer list were recovered (fetch or checkpoint).
    for (const id of ["kettle", "teacups", "biscuits", "blanket", "chair", "lamp"] as ItemId[]) {
      if (!s.dropped.some((x) => x.id === id) && !this.stackMeshes.has(id)) this.spills.take(id);
    }
  }

  frame(s: RunState, dt: number) {
    this.syncStack(s);
    let d = s.d;
    let still = false;
    const pose = this.pose;
    pose.speed = s.speed;
    pose.stepPhase = s.stepPhase;
    pose.tilt = s.balance.tilt;
    pose.lean = s.balance.lean;
    pose.sit = 0;
    pose.bow = 0;

    // Worry: the most slid item, or a tilt close to the edge.
    let worst = 0;
    let side = Math.sign(s.balance.tilt) || 1;
    s.slides.forEach((v) => {
      if (Math.abs(v) > worst) {
        worst = Math.abs(v);
        side = Math.sign(v) || side;
      }
    });
    const target = Math.min(1, Math.max(worst * 1.8, (Math.abs(s.balance.tilt) - 0.12) / 0.2));
    pose.alarm += (target - pose.alarm) * Math.min(1, dt * (target > pose.alarm ? 12 : 3));
    pose.alarmSide = side;

    if (this.flop) {
      this.flop.t += dt;
      const t = this.flop.t;
      pose.flopSide = this.flop.side;
      if (t < FLOP_DOWN) {
        d = this.flop.fromD;
        pose.flop = this.calm
          ? 1
          : Math.min(1, t / 0.3) * (1 + Math.sin(Math.min(1, t / 0.3) * Math.PI) * 0.15);
        pose.alarm = 1;
      } else {
        if (t - dt < FLOP_DOWN) still = true;
        pose.flop = Math.max(0, 1 - (t - FLOP_DOWN) / 0.8);
        if (pose.flop === 0) this.flop = null;
      }
    } else pose.flop = 0;

    if (this.teaTime >= 0) {
      this.teaTime += dt;
      pose.sit = Math.min(1, this.teaTime / 0.5);
      pose.speed = 0;
      pose.alarm = 0;
      pose.tilt = 0;
      pose.lean = 0;
      if (this.silence && this.teaTime > 1.5 && this.teaTime < 6) pose.bow = 1;
      this.tea.update(dt);
    }

    // The world dims a little while the biscuits are mourned.
    this.hush += (pose.bow - this.hush) * Math.min(1, dt * 2);
    this.stage.key.intensity = 2.6 - 1.4 * this.hush;

    const p = pointAt(this.path, d);
    this.bear.root.position.set(p.x, p.y + (this.teaTime >= 0 ? this.seat * pose.sit : 0), p.z);
    this.bear.root.rotation.y = p.heading;
    this.tea.group.position.set(p.x, p.y + 0.02, p.z);
    this.tea.group.rotation.y = p.heading;
    this.bear.update(pose, dt, this.calm);

    // Wind: the grass leans with every gust along the ledge and shivers before it arrives.
    windUniforms.uTime.value += dt;
    const onLedge = s.d >= LEDGE.from && s.d < LEDGE.to && s.phase === "hiking";
    const g = onLedge ? gustAt(s.gustClock) : { dir: 0, strength: 0, warning: false };
    const push =
      g.strength * 0.35 + (g.warning ? 0.05 * Math.sin(windUniforms.uTime.value * 20) : 0);
    const r = this.rightAt(s.d).multiplyScalar(g.dir * push);
    const w = windUniforms.uWind.value;
    w.set(w.x + (r.x - w.x) * Math.min(1, dt * 6), w.y + (r.z - w.y) * Math.min(1, dt * 6));

    this.spills.update(dt);
    const mode = s.phase === "packing" ? "pack" : s.phase === "tea" ? "tea" : "hike";
    this.rig.update(mode, d, s.phase === "tea" ? 0 : s.stats.height, dt, still);
    this.stage.follow(this.bear.root.position);
    this.stage.render();
    this.lastD = s.d;
  }
}
