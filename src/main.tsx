import { createRoot } from "react-dom/client";
import { SoundCues } from "./audio/cues";
import { sound } from "./audio/sound";
import type { ItemId } from "./game/items";
import {
  createRun,
  drainEvents,
  fetchItem,
  movePacked,
  type RunState,
  startHike,
  stepRun,
  togglePack,
} from "./game/run";
import { type TeaOutcome, teaOutcome } from "./game/tea";
import { worldReady } from "./loader";
import { GameScene } from "./scene/game-scene";
import { type Actions, App } from "./ui/App";
import { hasSeenHint, markHintSeen } from "./ui/Hint";
import { bindKeyboard, readInput, releaseAll } from "./ui/input";
import { publish, showToast, snapshot } from "./ui/store";
import "./ui/styles.css";
import { installVisualTest, visual, visualFrame, visualTestEnabled } from "./visual-test";

// Wiring: one run state, a fixed-step simulation, the three.js scene and the React HUD.

const STEP = 1 / 120;
const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const mobile = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 700;

const canvas = document.createElement("canvas");
canvas.id = "stage";
canvas.setAttribute("aria-hidden", "true");
document.body.prepend(canvas);

const scene = new GameScene(canvas, mobile, calm);
let run: RunState = createRun();
let outcome: TeaOutcome | null = null;
let hintOpen = false;
let hudDirty = true;
const cues = new SoundCues();
scene.onSpillLand = (id) => cues.land(id);
scene.onFootfall = (side, strength, splash) => cues.footfall(side, strength, run, splash);
scene.onShake = () => cues.shake();

// Audio starts on the first gesture; M toggles mute anywhere.
const unlock = () => sound.unlock();
window.addEventListener("pointerdown", unlock, { capture: true });
window.addEventListener("keydown", (e) => {
  unlock();
  if (e.code === "KeyM" && !e.repeat && !e.metaKey && !e.ctrlKey) sound.toggleMuted();
});

const LINES: Partial<Record<ItemId, string>> = {
  biscuits: "The biscuits tumble into the grass.",
  kettle: "Clang. The kettle is off.",
  lamp: "The lamp topples majestically.",
  teacups: "A tinkle of teacups.",
  chair: "The chair makes a break for it.",
  blanket: "The blanket flops away.",
};

function layout() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  scene.stage.resize(w, h);
  const wide = w >= 1024;
  if (run.phase === "hiking") scene.stage.setShift(0, -Math.round(h * 0.05));
  else if (wide) scene.stage.setShift(200, 0);
  else scene.stage.setShift(0, Math.round(h * 0.22));
}

const actions: Actions = {
  toggle(id) {
    const adding = !run.packed.includes(id);
    togglePack(run, id);
    if (adding) sound.play(id, { gain: 0.6 });
    else sound.play("ui-back", { gain: 0.6 });
    hudDirty = true;
  },
  move(i, dir) {
    movePacked(run, i, dir);
    sound.play("ui-tick", { gain: 0.7 });
    hudDirty = true;
  },
  start() {
    startHike(run);
    releaseAll();
    sound.play("jingle-start", { gain: 0.6 });
    hintOpen = !hasSeenHint();
    layout();
    hudDirty = true;
  },
  fetch(id) {
    if (fetchItem(run, id)) showToast(`Trotted back for the ${id === "teacups" ? "teacups" : id}.`);
    hudDirty = true;
  },
  replay() {
    const packed = [...run.packed];
    run = createRun(packed);
    outcome = null;
    scene.reset();
    cues.reset();
    sound.play("ui-select", { gain: 0.7 });
    layout();
    hudDirty = true;
  },
  closeHint() {
    hintOpen = false;
    markHintSeen();
    sound.play("ui-confirm", { gain: 0.6 });
    hudDirty = true;
  },
};

const visualApi = visualTestEnabled()
  ? installVisualTest(scene, (r) => {
      run = r;
      outcome = null;
      hudDirty = true;
    })
  : null;

bindKeyboard(() => run.phase === "hiking" && !hintOpen);
window.addEventListener("resize", layout);
layout();

const rootEl = document.getElementById("root");
if (rootEl) createRoot(rootEl).render(<App actions={actions} />);

let last = performance.now();
let acc = 0;
let sinceHud = 0;
let first = true;
let sceneReady = false;
scene.ready.then(
  () => {
    sceneReady = true;
  },
  () => {
    sceneReady = true;
  },
);
// Adaptive quality: if frames average over 16.7 ms for two seconds, drop GTAO, then resolution.
let slowTime = 0;
let slowFrames = 0;
let adaptCooldown = 3;

function tick(now: number) {
  // Up to 0.1 s per frame keeps the simulation in real time even on slow software rendering.
  const raw = (now - last) / 1000;
  const dt = visual.frozen ? visual.step : Math.min(0.1, raw);
  visual.step = 0;
  last = now;
  if (!visualApi && raw < 1) {
    adaptCooldown -= raw;
    slowTime += raw;
    slowFrames++;
    if (slowTime >= 2) {
      if (adaptCooldown <= 0 && slowTime / slowFrames > 1 / 60 + 0.0005 && scene.stage.degrade())
        adaptCooldown = 3;
      slowTime = 0;
      slowFrames = 0;
    }
  }
  if (run.phase === "hiking" && !hintOpen) {
    acc += dt;
    const input = readInput();
    while (acc >= STEP) {
      stepRun(run, input, STEP);
      acc -= STEP;
      if (run.phase !== "hiking") break;
    }
    const events = drainEvents(run);
    if (events.length) hudDirty = true;
    scene.handle(events, run);
    cues.events(events, run);
    for (const e of events) {
      if (e.type === "drop") showToast(LINES[e.id] ?? "Something fell off.");
      else if (e.type === "topple") showToast("Oof. Back to the last flag (+4 s).");
      else if (e.type === "checkpoint" && e.at > 0)
        showToast("Flag reached: your load is saved here.");
      else if (e.type === "arrive") {
        outcome = teaOutcome(run.packed, run.stack);
        cues.arrive(scene.arrive(outcome), outcome);
        releaseAll();
        layout();
      }
    }
  }
  scene.frame(run, dt);
  visualFrame();
  cues.frame(run, dt, hintOpen);
  sinceHud += dt;
  if (hudDirty || sinceHud > 1 / 15) {
    publish(snapshot(run, outcome, hintOpen));
    hudDirty = false;
    sinceHud = 0;
  }
  if (first && sceneReady) {
    first = false;
    requestAnimationFrame(() => {
      worldReady();
      if (visualApi) visualApi.ready = true;
    });
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
