import { createRoot } from "react-dom/client";
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
    togglePack(run, id);
    hudDirty = true;
  },
  move(i, dir) {
    movePacked(run, i, dir);
    hudDirty = true;
  },
  start() {
    startHike(run);
    releaseAll();
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
    layout();
    hudDirty = true;
  },
  closeHint() {
    hintOpen = false;
    markHintSeen();
    hudDirty = true;
  },
};

bindKeyboard(() => run.phase === "hiking" && !hintOpen);
window.addEventListener("resize", layout);
layout();

const rootEl = document.getElementById("root");
if (rootEl) createRoot(rootEl).render(<App actions={actions} />);

let last = performance.now();
let acc = 0;
let sinceHud = 0;
let first = true;

function tick(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
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
    for (const e of events) {
      if (e.type === "drop") showToast(LINES[e.id] ?? "Something fell off.");
      else if (e.type === "topple") showToast("Oof. Back to the last flag (+4 s).");
      else if (e.type === "checkpoint" && e.at > 0)
        showToast("Flag reached: your load is saved here.");
      else if (e.type === "arrive") {
        outcome = teaOutcome(run.packed, run.stack);
        scene.arrive(outcome);
        releaseAll();
        layout();
      }
    }
  }
  scene.frame(run, dt);
  sinceHud += dt;
  if (hudDirty || sinceHud > 1 / 15) {
    publish(snapshot(run, outcome, hintOpen));
    hudDirty = false;
    sinceHud = 0;
  }
  if (first) {
    first = false;
    requestAnimationFrame(() => worldReady());
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
