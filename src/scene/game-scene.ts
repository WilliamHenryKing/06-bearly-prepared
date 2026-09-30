import gsap from "gsap";
import * as THREE from "three";
import type { ItemId } from "../game/items";
import { layoutStack, PACK_TOP } from "../game/load";
import { FETCH_BUSY, type RunEvent, type RunState } from "../game/run";
import type { TeaOutcome } from "../game/tea";
import {
  CHECKPOINTS,
  camberAt,
  gustAt,
  LEDGE,
  type PathPoint,
  pointAt,
  samplePath,
  TRAIL_LENGTH,
} from "../game/trail";
import { batchStatic } from "./batch";
import { Bear, restPose } from "./bear";
import { type Bookmark, bookmarkCamera } from "./bookmarks";
import { CameraRig } from "./camera";
import { Crowd } from "./crowd";
import { buildDressing } from "./dressing";
import { furUniforms } from "./fur";
import { setBakedLand } from "./land";
import { Landmarks } from "./landmarks";
import { PALETTE, provideDetail } from "./materials";
import { Pond } from "./pond";
import { buildProp, cup, plate, spreadBlanket, stove } from "./props";
import type { QualityTier } from "./quality";
import { Spills } from "./spills";
import { Stage } from "./stage";
import { TeaScene } from "./tea";
import { buildTerrain, buildTrail, Ground } from "./terrain";
import { createGroundMaterial } from "./terrain-material";
import { loadPbrSet, setAnisotropy } from "./textures";
import { treeMaterials } from "./trees";
import { buildVegetation, thinGrass, windUniforms } from "./vegetation";
import { Village } from "./village";
import { NEAR, Vista } from "./vista";
import { loadVista } from "./vista-assets";
import { Wetness } from "./wetness";
import { WindStreaks } from "./wind";

// Turns the rules' state into the picture each frame: places the bear on the trail, mirrors
// the simulated stack, throws spills, plays topples and lays out the tea.

const FLOP_DOWN = 0.9;
/** A trip lies face down a little longer: long enough to see the load scatter. */
const TRIP_DOWN = 1.35;

export class GameScene {
  readonly stage: Stage;
  private path: PathPoint[];
  private ground: Ground;
  private bear: Bear;
  private rig: CameraRig;
  private spills: Spills;
  private tea = new TeaScene();
  private flags: THREE.Mesh[];
  private stackMeshes = new Map<ItemId, THREE.Group>();
  private pose = restPose();
  private flop: { t: number; fromD: number; side: number; forward: boolean } | null = null;
  /** 0 … 1, eased toward the rules' airborne flag. */
  private air = 0;
  /** The walking surface this frame (the cambered trail), for the bear's feet. */
  private surface = { x: 0, y: 0, z: 0, rx: 1, rz: 0, tilt: 0 };
  private lastD = 0;
  private teaTime = -1;
  private seat = 0;
  private silence = false;
  private hush = 0;
  private clock = 0;
  private shot: Bookmark | null = null;
  private react = 0;
  private reactSide = 1;
  private fetchT = -1;
  private landmarks: Landmarks;
  private streaks = new WindStreaks();
  private pond: Pond;
  private vista: Vista | null = null;
  private crowd: Crowd;
  private village: Village;
  private wetness: Wetness;
  /** How far the bear has stepped down into the pond (visual only). */
  private wade = 0;
  private footfallHandler: ((side: number, strength: number, splash: boolean) => void) | null =
    null;
  /** The scene is drawn once its shaders are compiled (behind the arrival veil until then). */
  private warmed = false;
  private readonly born = performance.now();

  constructor(
    canvas: HTMLCanvasElement,
    mobile: boolean,
    private calm: boolean,
    quality?: QualityTier,
  ) {
    this.stage = new Stage(canvas, mobile, quality);
    this.bear = new Bear(mobile ? "low" : "high");
    this.path = samplePath();
    this.pond = new Pond(this.path);
    this.ground = new Ground(this.path, this.pond);
    this.wetness = new Wetness(this.bear, this.pond);
    // Feet plant on the trail's cambered surface: lower on the downhill side.
    this.bear.ground = (x, z) => {
      const f = this.surface;
      return f.y - ((x - f.x) * f.rx + (z - f.z) * f.rz) * f.tilt;
    };
    this.bear.onFootfall = (side, strength) => {
      const splash = this.wetness.footfall(side, strength);
      this.footfallHandler?.(side, strength, splash);
    };
    const { scene } = this.stage;
    this.ready = this.load(mobile);
    const dressing = buildDressing(this.path);
    scene.add(dressing.group);
    this.flags = dressing.flags;
    this.spills = new Spills(this.ground);
    scene.add(this.spills.group, this.bear.root, this.tea.group);
    scene.add(this.pond.mesh, this.wetness.droplets.mesh);
    this.crowd = new Crowd(this.path, (x, z) => this.ground.height(x, z), calm);
    scene.add(this.crowd.group);
    this.village = new Village(this.path, (x, z) => this.ground.height(x, z));
    scene.add(this.village.group);
    this.landmarks = new Landmarks(this.path);
    scene.add(this.landmarks.group, this.streaks.group);
    // The set dressing's still parts, baked into a few meshes per stretch of the walk.
    batchStatic(dressing.group, dressing.flags);
    batchStatic(this.village.group, this.village.moving);
    batchStatic(this.landmarks.group, this.landmarks.moving);
    // The bunting flutters in its shader, which the AO pre-pass would draw at rest.
    this.stage.aoHidden.push(this.streaks.group, this.village.bunting);
    this.rig = new CameraRig(this.stage.camera, this.path);
    windUniforms.uSway.value = calm ? 0.25 : 1;
  }

  /** Resolves once the textured ground and trail are in the scene. */
  readonly ready: Promise<void>;

  private async load(mobile: boolean) {
    const anisotropy = Math.min(8, this.stage.renderer.capabilities.getMaxAnisotropy());
    setAnisotropy(anisotropy);
    // The baked mountains and sky first: every height asked for from here on is the baked land.
    const vista = await loadVista(mobile, anisotropy).catch((e) => {
      console.warn("vista bake unavailable; using the analytic land", e);
      return null;
    });
    if (vista) {
      setBakedLand(vista.inner, vista.outer);
      this.stage.setSkyPanorama(vista.sky, vista.skyEnv, vista.info.sky);
    }
    const [turf, dirt, rock, wool, planks, hessian, barkSet] = await Promise.all([
      loadPbrSet("grass_ground"),
      loadPbrSet("rocky_trail"),
      loadPbrSet("rock_face_03"),
      loadPbrSet("wool_boucle"),
      loadPbrSet("distressed_painted_planks"),
      loadPbrSet("hessian_230"),
      loadPbrSet("bark_brown_02"),
    ]);
    provideDetail({ felt: wool, wood: planks, cloth: hessian, bark: barkSet });
    const ground = createGroundMaterial({ turf, dirt, rock });
    this.stage.scene.add(
      buildTerrain(
        this.ground,
        new THREE.Vector2(NEAR.x, NEAR.z),
        NEAR.half * 2,
        mobile ? 170 : 290,
        ground,
      ),
      buildTrail(this.path, TRAIL_LENGTH, dirt, this.ground),
      this.pond.buildPatch((x, z) => this.ground.height(x, z), ground),
      await buildVegetation(this.ground, this.path, mobile),
    );
    this.vista = new Vista(
      this.stage.renderer,
      this.stage.sunDir,
      treeMaterials(barkSet),
      mobile ? 0.45 : 1,
      vista,
    );
    this.stage.scene.add(this.vista.group);
    this.stage.aoHidden.push(this.vista.birds.mesh, this.vista.land);
    await Promise.all([this.bear.ready, this.crowd.ready]);
    // The fur is too fine for GTAO's G-buffer; the inflated proxy stands in for it there.
    this.stage.aoHidden.push(...this.bear.furMeshes);
    this.stage.degradeSteps.push(() => this.bear.thinFur());
    // Then thin the scanned grass by half (once).
    let thinned = false;
    this.stage.degradeSteps.push(() => {
      if (thinned) return false;
      thinned = true;
      for (const m of thinGrass) m.count = Math.floor(m.count / 2);
      return true;
    });
    // Every shader, compiled before the first full frame; the load's props and the tea things
    // too, so packing and arriving never stall on one.
    const later = new THREE.Group();
    for (const id of ["kettle", "teacups", "biscuits", "blanket", "chair", "lamp"] as ItemId[])
      later.add(buildProp(id));
    later.add(spreadBlanket(), plate(true), plate(false), cup(), stove());
    await this.stage.precompile(later);
    this.warmed = true;
  }

  set onFootfall(fn: (side: number, strength: number, splash: boolean) => void) {
    this.footfallHandler = fn;
  }

  set onShake(fn: () => void) {
    this.wetness.onShake = fn;
  }

  /** Evidence captures: set how wet the bear is. */
  setWet(line: number, soak: number, splash = 0, frizz = 0) {
    this.wetness.set(line, soak, splash, frizz);
  }

  /** Back to the trailhead for a new run. */
  reset() {
    this.spills.clear();
    this.tea.clear();
    this.wetness.reset();
    this.wade = 0;
    this.flop = null;
    this.air = 0;
    this.village.reset();
    this.teaTime = -1;
    this.silence = false;
    this.pose = restPose();
    this.react = 0;
    this.fetchT = -1;
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
        this.react = 1;
        this.reactSide = e.side;
      } else if (e.type === "fetch") {
        const top = this.bear.load.localToWorld(new THREE.Vector3(0, PACK_TOP + s.stats.height, 0));
        this.spills.take(e.id, top);
        this.bear.bump(1);
        this.fetchT = 0;
      } else if (e.type === "topple") {
        this.flop = { t: 0, fromD: this.lastD, side: e.side, forward: false };
        const p = pointAt(this.path, this.lastD);
        this.spills.puff(new THREE.Vector3(p.x, p.y, p.z), 10);
      } else if (e.type === "trip") {
        // Caught a foot on the log: face-first over it, and the whole load carries on without
        // the bear. The rules have already put everything back at the last flag; the scattered
        // pieces puff away once the bear is back there.
        this.flop = {
          t: 0,
          fromD: this.lastD,
          side: Math.sign(s.balance.tilt) || 1,
          forward: true,
        };
        const p = pointAt(this.path, this.lastD);
        const ahead = new THREE.Vector3(-Math.sin(p.heading), 0, -Math.cos(p.heading));
        const right = this.rightAt(this.lastD);
        let i = 0;
        for (const [id, mesh] of this.stackMeshes) {
          const throwDir = ahead
            .clone()
            .multiplyScalar(0.7 + 0.22 * i)
            .addScaledVector(right, (Math.random() - 0.5) * 0.9);
          this.spills.drop(id, mesh, throwDir, this.calm);
          i++;
        }
        this.stackMeshes.clear();
        this.spills.puff(new THREE.Vector3(p.x, p.y, p.z).addScaledVector(ahead, 0.5), 12);
        this.bear.bump(1.2);
      } else if (e.type === "jump") {
        this.bear.bump(0.35);
      } else if (e.type === "land") {
        this.bear.bump(0.5 + e.strength * 0.8);
        const p = pointAt(this.path, s.d);
        this.spills.puff(new THREE.Vector3(p.x, p.y, p.z), 3 + Math.round(e.strength * 5));
      } else if (e.type === "bump") {
        this.crowd.bump(e.who);
        this.bear.bump(0.9);
        this.react = Math.max(this.react, 0.6);
        this.reactSide = e.side || 1;
      } else if (e.type === "branch") {
        if (e.hit) this.village.bump(e.at);
        this.bear.bump(0.9);
        this.react = Math.max(this.react, 0.6);
        this.reactSide = e.side || 1;
      } else if (e.type === "goose" && e.kind !== "peck") {
        this.village.gooseEvent(e.kind);
      } else if (e.type === "goose" && e.kind === "peck") {
        this.village.gooseEvent("peck");
        this.bear.bump(0.6);
        this.react = Math.max(this.react, 0.5);
        this.reactSide = e.side ?? 1;
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

  set onSpillLand(fn: (id: ItemId) => void) {
    this.spills.onLand = fn;
  }

  /** Lays out the tea; returns when each piece appears. */
  arrive(outcome: TeaOutcome) {
    this.seat = this.tea.build(outcome, this.calm);
    this.silence = outcome.silence;
    this.teaTime = 0;
    this.bear.load.visible = false;
    for (const m of this.stackMeshes.values()) this.bear.load.remove(m);
    this.stackMeshes.clear();
    return this.tea.pops;
  }

  /** Evidence captures: a fixed point in the bear's walk cycle. */
  setGaitPhase(phase: number) {
    this.bear.phase = phase;
  }

  /** Evidence captures: hold a fixed camera bookmark instead of the follow camera. */
  setShot(b: Bookmark | null) {
    this.shot = b;
    if (b) {
      this.stage.camera.fov = b.fov;
      this.stage.setShift(0, 0);
    }
    this.rig.snap();
  }

  private rightAt(d: number) {
    const h = pointAt(this.path, d).heading;
    return new THREE.Vector3(Math.cos(h), 0, -Math.sin(h));
  }

  private syncStack(s: RunState) {
    if (s.phase === "tea") return;
    // Spills that the rules no longer list were recovered (fetched, or restored at a flag after
    // a topple or a trip): the pieces lying in the grass puff away.
    for (const id of ["kettle", "teacups", "biscuits", "blanket", "chair", "lamp"] as ItemId[]) {
      if (!s.dropped.some((x) => x.id === id)) this.spills.take(id);
    }
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
      // Higher pieces lag the sway a little, so the stack flexes like a noodle.
      const lag = -s.balance.spin * 0.035 * i;
      // Past half-way to falling, a piece teeters on its edge: the warning before a spill.
      const edge = Math.max(0, (Math.abs(slide) - 0.45) / 0.55);
      const teeter = this.calm ? 0 : Math.sin(this.clock * 26 + i * 2) * 0.16 * edge;
      mesh.position.set(slide * 0.34, entry.bottom + Math.abs(rattle) + Math.abs(teeter) * 0.08, 0);
      mesh.rotation.set(
        0,
        0,
        -slide * 0.35 - edge * Math.sign(slide) * 0.2 + rattle + lag + teeter,
      );
    });
  }

  frame(s: RunState, dt: number) {
    this.clock += dt;
    // While the bear lies face down after a trip, its load is scattered on the trail.
    const sprawled = this.flop?.forward && this.flop.t < TRIP_DOWN;
    if (!sprawled) this.syncStack(s);
    let d = s.d;
    let still = false;
    const pose = this.pose;
    pose.speed = s.speed;
    pose.stepPhase = s.stepPhase;
    pose.tilt = s.balance.tilt;
    pose.lean = s.balance.lean;
    pose.sit = 0;
    pose.bow = 0;
    pose.load = Math.min(1, Math.max(0, (s.stats.mass - 1) / 12));

    // Dismay after a spill; a quick turn-and-trot when fetching something back.
    this.react = Math.max(0, this.react - dt * 0.9);
    pose.react = this.calm ? Math.min(this.react, 0.5) : this.react;
    pose.reactSide = this.reactSide;
    pose.turn = 0;
    if (this.fetchT >= 0) {
      this.fetchT += dt;
      const u = Math.min(1, this.fetchT / FETCH_BUSY);
      pose.turn = Math.PI * Math.sin(u * Math.PI);
      pose.speed = 1.4;
      pose.stepPhase = this.clock * 9;
      if (u >= 1) this.fetchT = -1;
    }

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

    this.air += ((s.airborne ? 1 : 0) - this.air) * Math.min(1, dt * (s.airborne ? 16 : 11));
    pose.air = this.calm ? this.air * 0.6 : this.air;
    if (this.flop) {
      this.flop.t += dt;
      const t = this.flop.t;
      const down = this.flop.forward ? TRIP_DOWN : FLOP_DOWN;
      pose.flopSide = this.flop.side;
      pose.flopForward = this.flop.forward ? 1 : 0;
      pose.air = 0;
      if (t < down) {
        // A trip carries the bear a stride past the log as it goes down.
        d = this.flop.fromD + (this.flop.forward ? 0.35 * Math.min(1, t / 0.35) : 0);
        const fall = this.flop.forward ? 0.28 : 0.3;
        pose.flop = this.calm
          ? 1
          : Math.min(1, t / fall) * (1 + Math.sin(Math.min(1, t / fall) * Math.PI) * 0.15);
        pose.alarm = 1;
      } else {
        if (t - dt < down) still = true;
        pose.flop = Math.max(0, 1 - (t - down) / 0.8);
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
    this.stage.hush(this.hush);
    this.vista?.hush(this.hush);

    const p = pointAt(this.path, d);
    // Through the pond the bear walks down the bed and wades (the rules never see the dip).
    const dip =
      this.pond.e(p.x, p.z) < 1.2 ? Math.max(0, p.y + 0.007 - this.ground.height(p.x, p.z)) : 0;
    this.wade += (dip - this.wade) * (dt > 0 ? Math.min(1, dt * 10) : 1);
    this.bear.root.position.set(
      p.x,
      p.y + (this.flop ? 0 : s.y) - this.wade + (this.teaTime >= 0 ? this.seat * pose.sit : 0),
      p.z,
    );
    this.bear.root.rotation.y = p.heading + pose.turn;
    const across = this.rightAt(d);
    this.surface.x = p.x;
    this.surface.y = p.y - this.wade;
    this.surface.z = p.z;
    this.surface.rx = across.x;
    this.surface.rz = across.z;
    this.surface.tilt = Math.tan(camberAt(d));
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
    // The same wind combs the bear's fur, with a light breeze that never quite stops.
    furUniforms.uTime.value += dt;
    const breeze = this.calm
      ? 0
      : Math.sin(this.clock * 1.7) * 0.06 + Math.sin(this.clock * 4.3) * 0.03;
    furUniforms.uWind.value.set(w.x * 1.6 + breeze, 0, w.y * 1.6 + breeze * 0.5);

    const right = this.rightAt(s.d);
    const rate = onLedge ? (g.warning ? 5 : 1.5) + g.strength * 40 : 0;
    this.streaks.update(
      dt,
      this.bear.root.position,
      right,
      g.dir || 1,
      this.calm ? rate * 0.3 : rate,
    );
    this.landmarks.update(g.dir * (0.15 + g.strength), this.clock, this.calm);
    this.spills.update(dt);
    this.pond.update(dt);
    this.vista?.update(dt);
    this.crowd.update(s.time, dt);
    this.village.update(s.goose, dt, this.calm);
    this.wetness.update(dt, pose.speed, onLedge && g.strength > 0.2);
    this.rig.teaTime = Math.max(0, this.teaTime);
    const mode = s.phase === "packing" ? "pack" : s.phase === "tea" ? "tea" : "hike";
    if (this.shot) {
      const cam = bookmarkCamera(this.path, this.shot);
      this.stage.camera.position.copy(cam.pos);
      this.stage.camera.lookAt(cam.look);
    } else this.rig.update(mode, d, s.phase === "tea" ? 0 : s.stats.height, dt, still);
    this.stage.follow(this.bear.root.position);
    // Until the shaders are compiled the arrival veil hides the canvas (its safety reveal comes
    // at 30 s, and from then on the scene is drawn regardless).
    if (this.warmed || performance.now() - this.born > 29500) this.stage.render();
    this.lastD = s.d;
  }
}
