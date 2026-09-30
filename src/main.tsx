import { createRoot } from "react-dom/client";
import { SoundCues } from "./audio/cues";
import { sound } from "./audio/sound";
import { ITEMS, type ItemId } from "./game/items";
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
import { LOGS } from "./game/trail";
import { worldReady } from "./loader";
import { OPENING_GLIDE } from "./scene/camera";
import { GameScene } from "./scene/game-scene";
import { detectQuality, tierSettings } from "./scene/quality";
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

const scene = new GameScene(canvas, mobile, calm, tierSettings(detectQuality(mobile)));
let run: RunState = createRun();
let outcome: TeaOutcome | null = null;
// The opening: a title card over the valley, then a glide down to the bear (skipped for
// captures and tests, unless ?intro).
let opening: "title" | "glide" | "done" =
  !visualTestEnabled() || new URLSearchParams(window.location.search).has("intro")
    ? "title"
    : "done";
let openingClock = 0;
scene.title = opening === "title";
// The guided first minute (-1: off). Each step waits for the player: walk, lean against the
// sway, steady the load, then the first log.
let guide = -1;
let guideClock = 0;
let guideFrom = { d: 0, logs: 0, trips: 0 };
let leanHeld = 0;
function guideTo(step: number) {
  guide = step;
  guideClock = 0;
  guideFrom = { d: run.d, logs: run.logsPassed, trips: run.trips };
  leanHeld = 0;
  if (step < 0) markHintSeen();
  hudDirty = true;
}
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

/** Villagers the bear walks into, never looking up. */
const BUMPS = [
  "Sorry! (They didn't look up.)",
  "Bumped a scroller. Wait for a gap!",
  '"Watch it, I\'m on a call."',
  "They're filming a story. You're in it now.",
  "Nobody here looks where they walk.",
];
const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)] as T;
const ITEM_NAMES: Partial<Record<ItemId, string>> = Object.fromEntries(
  Object.entries(ITEMS).map(([id, def]) => [id, def.name.toLowerCase()]),
);

const LINES: Partial<Record<ItemId, string>> = {
  biscuits: "The biscuits tumble into the grass.",
  kettle: "Clang. The kettle is off.",
  lamp: "The lamp topples majestically.",
  teacups: "A tinkle of teacups.",
  chair: "The chair makes a break for it.",
  blanket: "The blanket flops away.",
};

function layout(resize = true) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (resize) scene.stage.resize(w, h);
  const wide = w >= 1024;
  if (run.phase === "hiking") scene.stage.setShift(0, -Math.round(h * 0.05));
  else {
    // The title card is on the left (at the foot on a phone) and the pack panel on the right
    // (at the foot): the view slides between the two framings as the opening glides down.
    const title = wide ? [-Math.round(w * 0.15), 0] : [0, Math.round(h * 0.2)];
    const pack = wide ? [200, 0] : [0, Math.round(h * 0.22)];
    const u = opening === "title" ? 0 : opening === "glide" ? openingClock / OPENING_GLIDE : 1;
    const k = Math.min(1, u) * Math.min(1, u) * (3 - 2 * Math.min(1, u));
    scene.stage.setShift(
      Math.round((title[0] ?? 0) + ((pack[0] ?? 0) - (title[0] ?? 0)) * k),
      Math.round((title[1] ?? 0) + ((pack[1] ?? 0) - (title[1] ?? 0)) * k),
    );
  }
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
  begin() {
    if (opening !== "title") return;
    opening = "glide";
    openingClock = 0;
    scene.title = false;
    sound.play("ui-confirm", { gain: 0.6 });
    hudDirty = true;
  },
  start() {
    startHike(run);
    releaseAll();
    sound.play("jingle-start", { gain: 0.6 });
    guideTo(hasSeenHint() ? -1 : 0);
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
  skipGuide() {
    guideTo(-1);
    sound.play("ui-confirm", { gain: 0.6 });
  },
  showGuide() {
    guideTo(0);
    sound.play("ui-select", { gain: 0.6 });
  },
};

const visualApi = visualTestEnabled()
  ? installVisualTest(
      scene,
      (r) => {
        run = r;
        outcome = null;
        hudDirty = true;
      },
      () => run,
    )
  : null;

bindKeyboard(() => run.phase === "hiking");
// The title card's Enter: begin (its button has focus, so this is for keys pressed elsewhere).
window.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.repeat || opening !== "title") return;
  if ((e.target as HTMLElement | null)?.closest("button")) return;
  e.preventDefault();
  actions.begin();
});
window.addEventListener("resize", () => layout());
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
  if (opening === "glide") {
    openingClock += raw;
    if (openingClock >= OPENING_GLIDE) {
      opening = "done";
      hudDirty = true;
    }
    layout(false);
  }
  if (run.phase === "hiking") {
    acc += dt;
    const input = readInput();
    if (guide >= 0) {
      guideClock += dt;
      if (input.lean !== 0) leanHeld += dt;
      if (guide === 0 && run.d - guideFrom.d > 2.5) guideTo(1);
      else if (guide === 1 && (leanHeld > 0.5 || guideClock > 10)) guideTo(2);
      else if (guide === 2 && guideClock > 7) guideTo(run.logsPassed >= LOGS.length ? -1 : 3);
      else if (guide === 3 && (run.logsPassed > guideFrom.logs || run.trips > guideFrom.trips))
        guideTo(-1);
    }
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
      else if (e.type === "trip") showToast("Tripped on a log! Jump them next time (Space).");
      else if (e.type === "bump") showToast(pick(BUMPS));
      else if (e.type === "branch" && e.hit)
        showToast(`Bonk! The ${ITEM_NAMES[e.hit] ?? "load"} hit a branch.`);
      else if (e.type === "goose") {
        if (e.kind === "honk") showToast("HONK. The goose is awake. Keep walking!");
        else if (e.kind === "peck") showToast("Ow! Pecked. Faster!");
        else if (e.kind === "steal") showToast("The goose stole the biscuits!");
        else if (e.kind === "quit") showToast("The goose gives up at the gate. Phew.");
      } else if (e.type === "checkpoint" && e.at > 0)
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
  cues.frame(run, dt, false);
  sinceHud += dt;
  if (hudDirty || sinceHud > 1 / 15) {
    // The logs step waits, hidden, until the next log is in sight.
    const nextLog = LOGS[run.logsPassed]?.at ?? 0;
    const shown = guide === 3 && run.d < nextLog - 9 ? -1 : guide;
    publish(snapshot(run, outcome, shown, opening));
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
