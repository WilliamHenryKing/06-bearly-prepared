import * as THREE from "three";
import { Bear, type BearPose, restPose } from "./scene/bear";
import { FUR_COLOURS, furUniforms } from "./scene/fur";
import { Stage } from "./scene/stage";
import { applySet, loadPbrSet, repeated, setAnisotropy } from "./scene/textures";

// Look-dev harness (docs/visual, Visual Quality Directive §3.3): the game's exact renderer, sky,
// sun, environment and post chain, with the bear on a turntable beside an 18% grey sphere, a
// mirror sphere and a ColorChecker chart. Everything is driven by the URL or window.__LOOKDEV__,
// so batch renders are repeatable. Development only (lookdev.html is not in the production build).
//
// Parameters: cam=full|face|side|back|feet, angle (degrees), speed (m/s), phase (gait, radians),
// play=1 (animate in real time), wet (soak line height, m), soak, splash, frizz, len (m), density,
// clump, shells hidden via thin, alarm, sit, load, refs=0 (hide the reference objects).

type Params = Record<string, string>;
const url = new URLSearchParams(location.search);
const params: Params = Object.fromEntries(url.entries());
const num = (k: string, d: number) => (params[k] !== undefined ? Number(params[k]) : d);

const canvas = document.createElement("canvas");
document.body.prepend(canvas);
const mobile = params.tier === "low";
const stage = new Stage(canvas, mobile);
const bear = new Bear(mobile ? "low" : "high");
stage.scene.add(bear.root);

// Reference objects to the bear's right, out of its turntable sweep.
const refs = new THREE.Group();
const grey = new THREE.Mesh(
  new THREE.SphereGeometry(0.12, 48, 32),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(0.18, 0.18, 0.18), roughness: 0.9 }),
);
grey.position.set(0.75, 0.12, 0.2);
const mirror = new THREE.Mesh(
  new THREE.SphereGeometry(0.12, 48, 32),
  new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0 }),
);
mirror.position.set(0.75, 0.12, -0.15);
refs.add(grey, mirror);
// ColorChecker Classic, published sRGB values, 4 × 6 patches.
const CHART = [
  0x735244, 0xc29682, 0x627a9d, 0x576c43, 0x8580b1, 0x67bdaa, 0xd67e2c, 0x505ba6, 0xc15a63,
  0x5e3c6c, 0x9dbc40, 0xe0a32e, 0x383d96, 0x469449, 0xaf363c, 0xe7c71f, 0xbb5695, 0x0885a1,
  0xf3f3f2, 0xc8c8c8, 0xa0a0a0, 0x7a7a79, 0x555555, 0x343434,
];
const chart = new THREE.Group();
CHART.forEach((c, i) => {
  const patch = new THREE.Mesh(
    new THREE.PlaneGeometry(0.058, 0.058),
    new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }),
  );
  patch.position.set((i % 6) * 0.064 - 0.16, 0.28 - Math.floor(i / 6) * 0.064, 0);
  chart.add(patch);
});
chart.position.set(-0.8, 0.02, -0.1);
chart.rotation.y = 0.5;
refs.add(chart);
for (const o of [grey, mirror]) o.castShadow = true;
stage.scene.add(refs);
refs.visible = params.refs !== "0";

// The meadow turf underfoot, so bounce light and contact read as they do in the game.
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(6, 64).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0xffffff }),
);
ground.receiveShadow = true;
stage.scene.add(ground);

const CAMS: Record<
  string,
  { eye: [number, number, number]; look: [number, number, number]; fov: number }
> = {
  full: { eye: [1.35, 1.05, -2.2], look: [0.05, 0.62, 0], fov: 38 },
  face: { eye: [0.42, 1.12, -0.82], look: [0, 1.04, -0.1], fov: 30 },
  side: { eye: [2.4, 0.7, 0], look: [0, 0.55, 0], fov: 34 },
  back: { eye: [0.9, 1.9, 3.1], look: [0, 0.75, -0.6], fov: 42 },
  feet: { eye: [0.9, 0.35, -1.1], look: [0, 0.18, 0], fov: 34 },
  /** Straight down the key light: turn the bear (angle=90) for a lit profile of the walk. */
  profile: { eye: [0, 0.7, -3.1], look: [0, 0.6, 0], fov: 30 },
};

// Cameras stand on the sun's side (key light over the viewer's left shoulder), so every preset
// is the front view it is named for rather than a silhouette against the sky.
const sunDir = stage.sun.sun.direction;
const facing = Math.atan2(sunDir[0], sunDir[2]) - 0.6 - Math.PI;
const turn = (p: [number, number, number]) =>
  new THREE.Vector3(...p).applyAxisAngle(new THREE.Vector3(0, 1, 0), facing);

const DEFAULTS = {
  len: furUniforms.uLength.value,
  density: furUniforms.uDensity.value,
  clump: furUniforms.uClump.value,
};
const pose: BearPose = restPose();
let angle = 0;
let play = false;
let ready = false;
/** Re-pose only when something changed, so films' stepped springs are not disturbed. */
let dirty = true;

function apply(p: Params) {
  // Each call describes the whole shot; only the tier (fixed at load) carries over.
  if (Object.keys(p).length) {
    const tier = params.tier;
    for (const k of Object.keys(params)) delete params[k];
    Object.assign(params, p, tier ? { tier } : {});
  }
  const cam = CAMS[params.cam ?? "full"] ?? (CAMS.full as (typeof CAMS)["full"]);
  stage.camera.fov = cam.fov;
  stage.camera.position.copy(turn(cam.eye));
  stage.camera.lookAt(turn(cam.look));
  stage.camera.updateProjectionMatrix();
  angle = (num("angle", 0) * Math.PI) / 180;
  play = params.play === "1";
  pose.speed = num("speed", 0);
  pose.alarm = num("alarm", 0);
  pose.sit = num("sit", 0);
  pose.load = num("load", 0.3);
  if (params.phase !== undefined) bear.phase = num("phase", 0);
  furUniforms.uWetLine.value = num("wet", -1);
  furUniforms.uSoak.value = num("soak", params.wet ? 1 : 0);
  furUniforms.uSplash.value = num("splash", 0);
  furUniforms.uFrizz.value = num("frizz", 0);
  furUniforms.uLength.value = num("len", DEFAULTS.len);
  furUniforms.uDensity.value = num("density", DEFAULTS.density);
  furUniforms.uClump.value = num("clump", DEFAULTS.clump);
  if (params.tip) FUR_COLOURS.bodyTip.set(`#${params.tip}`);
  if (params.root) FUR_COLOURS.bodyRoot.set(`#${params.root}`);
  refs.visible = params.refs !== "0";
  dirty = true;
}

const hud = document.getElementById("hud");
let frames = 0;
const waiters: { n: number; done: () => void }[] = [];
const api = {
  get ready() {
    return ready;
  },
  set(p: Params) {
    apply(p);
  },
  /** Advance the animation by dt seconds without real time passing (films). */
  step(dt: number) {
    bear.update(pose, dt, false);
  },
  settle(n = 8) {
    return new Promise<void>((done) => waiters.push({ n: frames + n, done }));
  },
  info() {
    const gl = stage.renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      gpu: String(
        ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      ),
      three: THREE.REVISION,
      render: stage.renderer.info.render,
    };
  },
};
(window as unknown as { __LOOKDEV__: typeof api }).__LOOKDEV__ = api;

function resize() {
  stage.resize(window.innerWidth, window.innerHeight);
  apply({});
}
window.addEventListener("resize", resize);

async function start() {
  setAnisotropy(Math.min(8, stage.renderer.capabilities.getMaxAnisotropy()));
  const turf = await loadPbrSet("grass_ground");
  applySet(ground.material, repeated(turf, 3));
  await bear.ready;
  stage.aoHidden.push(...bear.furMeshes);
  resize();
  bear.update(pose, 0, false);
  let last = performance.now();
  const tick = (now: number) => {
    const dt = play ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    bear.root.rotation.y = angle + facing;
    if (play || dirty) bear.update(pose, dt, false);
    dirty = false;
    furUniforms.uTime.value += dt;
    stage.follow(new THREE.Vector3(0, 0.6, 0));
    stage.render();
    frames++;
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      if (w && frames >= w.n) {
        waiters.splice(i, 1);
        w.done();
      }
    }
    if (hud && frames % 30 === 0) {
      const r = stage.renderer.info.render;
      hud.textContent = `calls ${r.calls} · tris ${r.triangles} · ${params.cam ?? "full"} ${Math.round((angle * 180) / Math.PI)}°`;
    }
    if (!ready && frames > 3) ready = true;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
start();
