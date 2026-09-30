import { createRoot } from "react-dom/client";
import { SoundCues } from "./audio/cues";
import { createSound } from "./audio/sound";
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
import { worldFailed, worldReady } from "./loader";
import { OPENING_GLIDE } from "./scene/camera";
import { GameScene } from "./scene/game-scene";
import { detectQuality, tierSettings } from "./scene/quality";
import { type Actions, App } from "./ui/App";
import { startGuide, stepGuide } from "./ui/guideProgress";
import { hasSeenHint, markHintSeen } from "./ui/Hint";
import { bindKeyboard, isEditingTarget, readInput, releaseAll } from "./ui/input";
import { clearToast, publish, showToast, snapshot } from "./ui/store";
import "./ui/styles.css";
import { installVisualTest, visual, visualFrame, visualTestEnabled } from "./visual-test";

// Wiring: one run state, a fixed-step simulation, the three.js scene and the React HUD.

const STEP = 1 / 120;
const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
let calm = motion.matches;
const mobile = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 700;

const canvas = document.createElement("canvas");
canvas.id = "stage";
canvas.setAttribute("aria-hidden", "true");
document.body.prepend(canvas);

const scene = (() => {
  try {
    return new GameScene(canvas, mobile, calm, tierSettings(detectQuality(mobile)));
  } catch (error) {
    worldFailed();
    throw error;
  }
})();
let disposed = false;
let failed = false;
let sceneReady = false;
let raf = 0;
let readyRaf = 0;
let acc = 0;
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
let guide = startGuide(run, -1);
function guideTo(step: number) {
  guide = startGuide(run, step);
  if (step < 0) markHintSeen();
  hudDirty = true;
}
let hudDirty = true;
const audio = createSound();
const cues = new SoundCues(audio);
scene.onSpillLand = (id) => cues.land(id);
scene.onFootfall = (side, strength, splash) => cues.footfall(side, strength, run, splash);
scene.onShake = () => cues.shake();

// Audio starts on the first gesture; M toggles mute anywhere.
const unlock = () => audio.unlock();
window.addEventListener("pointerdown", unlock, { capture: true });
const onAudioKey = (e: KeyboardEvent) => {
  unlock();
  if (
    e.code === "KeyM" &&
    !e.repeat &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.defaultPrevented &&
    !isEditingTarget(e.target)
  )
    audio.toggleMuted();
};
window.addEventListener("keydown", onAudioKey);

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
  // Match the short-landscape HUD column in styles.css and fit the remaining view.
  const short = w <= 720 && h <= 550 && w > h;
  const rail = short ? Math.min(320, w * 0.54) : 0;
  const portrait = w <= 899 && h >= w;
  const compactPortrait = portrait && w <= 799 && h <= 650;
  scene.stage.camera.zoom = run.phase === "hiking" && compactPortrait ? 0.68 : 1;
  scene.setViewAspect(short && opening !== "title" ? (w - rail) / h : null);
  if (run.phase === "hiking")
    scene.stage.setShift(
      short ? Math.round(rail / 2) : 0,
      short ? 0 : portrait ? Math.round(h * 0.18) : Math.round(h * 0.06),
    );
  else {
    // The title card is on the left (at the foot on a phone) and the pack panel on the right
    // (at the foot): the view slides between the two framings as the opening glides down.
    const title = wide ? [-Math.round(w * 0.15), 0] : [0, Math.round(h * 0.2)];
    const pack = short ? [Math.round(rail / 2), 0] : wide ? [200, 0] : [0, Math.round(h * 0.22)];
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
    if (!sceneReady || opening !== "done" || run.phase !== "packing") return;
    const adding = !run.packed.includes(id);
    const before = run.packed.join();
    togglePack(run, id);
    if (before === run.packed.join()) return;
    if (adding) audio.play(id, { gain: 0.6 });
    else audio.play("ui-back", { gain: 0.6 });
    hudDirty = true;
  },
  move(i, dir) {
    if (!sceneReady || opening !== "done" || run.phase !== "packing") return;
    const before = run.packed.join();
    movePacked(run, i, dir);
    if (before === run.packed.join()) return;
    audio.play("ui-tick", { gain: 0.7 });
    hudDirty = true;
  },
  begin() {
    if (!sceneReady || opening !== "title") return;
    releaseAll();
    opening = calm ? "done" : "glide";
    openingClock = calm ? OPENING_GLIDE : 0;
    scene.title = false;
    audio.play("ui-confirm", { gain: 0.6 });
    layout(false);
    hudDirty = true;
  },
  start() {
    if (!sceneReady || opening !== "done" || run.phase !== "packing") return;
    startHike(run);
    releaseAll();
    acc = 0;
    clearToast();
    audio.play("jingle-start", { gain: 0.6 });
    guideTo(hasSeenHint() ? -1 : 0);
    layout();
    hudDirty = true;
  },
  fetch(id) {
    if (!sceneReady || run.phase !== "hiking") return;
    if (fetchItem(run, id)) showToast(`Trotted back for the ${id === "teacups" ? "teacups" : id}.`);
    hudDirty = true;
  },
  replay() {
    if (!sceneReady || run.phase !== "tea") return;
    releaseAll();
    acc = 0;
    clearToast();
    const packed = [...run.packed];
    run = createRun(packed);
    outcome = null;
    scene.reset();
    cues.reset();
    audio.cancelPending();
    guide = startGuide(run, -1);
    audio.play("ui-select", { gain: 0.7 });
    layout();
    hudDirty = true;
  },
  skipGuide() {
    if (run.phase !== "hiking" || guide.step < 0) return;
    guideTo(-1);
    audio.play("ui-confirm", { gain: 0.6 });
  },
  showGuide() {
    if (run.phase !== "hiking") return;
    guideTo(0);
    audio.play("ui-select", { gain: 0.6 });
  },
};

const visualApi = visualTestEnabled()
  ? installVisualTest(
      scene,
      (r) => {
        releaseAll();
        acc = 0;
        cues.reset();
        audio.cancelPending();
        clearToast();
        run = r;
        outcome = null;
        guide = startGuide(run, -1);
        layout();
        hudDirty = true;
      },
      () => run,
      () => layout(),
    )
  : null;

const unbindKeyboard = bindKeyboard(() => sceneReady && run.phase === "hiking");
// The title card's Enter: begin (its button has focus, so this is for keys pressed elsewhere).
const onTitleKey = (e: KeyboardEvent) => {
  if (
    e.key !== "Enter" ||
    e.repeat ||
    e.defaultPrevented ||
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    opening !== "title" ||
    isEditingTarget(e.target)
  )
    return;
  if ((e.target as HTMLElement | null)?.closest("button")) return;
  e.preventDefault();
  actions.begin();
};
window.addEventListener("keydown", onTitleKey);
const onResize = () => layout();
window.addEventListener("resize", onResize);
layout();

const rootEl = document.getElementById("root");
const root = rootEl ? createRoot(rootEl) : null;
root?.render(<App actions={actions} />);

let last = performance.now();
let sinceHud = 0;
let first = true;
function fail() {
  if (disposed || failed) return;
  failed = true;
  sceneReady = false;
  releaseAll();
  audio.cancelPending();
  // Close top-layer dialogs before focusing the recovery action outside React.
  root?.unmount();
  worldFailed();
  visualApi?.dispose();
  cues.reset();
  audio.dispose();
  scene.dispose();
}
scene.ready.then(() => {
  if (!disposed && !failed) sceneReady = true;
}, fail);
const onVisibility = () => {
  releaseAll();
  acc = 0;
  last = performance.now();
};
document.addEventListener("visibilitychange", onVisibility);
// Adaptive quality: if frames average over 16.7 ms for two seconds, drop GTAO, then resolution.
let slowTime = 0;
let slowFrames = 0;
let adaptCooldown = 3;

function tick(now: number) {
  if (disposed || failed) return;
  try {
    frame(now);
  } catch (error) {
    console.error(error);
    fail();
    return;
  }
  raf = requestAnimationFrame(tick);
}
function frame(now: number) {
  // Up to 0.1 s per frame keeps the simulation in real time even on slow software rendering.
  const raw = Math.max(0, (now - last) / 1000);
  const dt = document.hidden || !sceneReady ? 0 : visual.frozen ? visual.step : Math.min(0.1, raw);
  visual.step = 0;
  last = now;
  if (calm !== motion.matches) {
    calm = motion.matches;
    scene.setCalm(calm);
    if (calm && opening === "glide") {
      opening = "done";
      openingClock = OPENING_GLIDE;
      layout(false);
      hudDirty = true;
    }
  }
  if (!visualApi && !document.hidden && sceneReady && raw < 1) {
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
    openingClock += dt;
    if (openingClock >= OPENING_GLIDE) {
      opening = "done";
      hudDirty = true;
    }
    layout(false);
  }
  if (run.phase === "hiking") {
    acc += dt;
    const input = readInput(acc >= STEP);
    while (acc >= STEP) {
      stepRun(run, input, STEP);
      acc -= STEP;
      if (run.phase !== "hiking") break;
    }
    const nextGuide = stepGuide(guide, run, input, dt);
    if (nextGuide.step !== guide.step) {
      hudDirty = true;
      if (nextGuide.step < 0) markHintSeen();
    }
    guide = nextGuide;
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
        acc = 0;
        layout();
      }
    }
  }
  scene.frame(run, dt);
  visualFrame();
  cues.frame(run, dt, document.hidden);
  sinceHud += dt;
  if (hudDirty || sinceHud > 1 / 15) {
    // The logs step waits, hidden, until the next log is in sight.
    const nextLog = LOGS[run.logsPassed]?.at ?? 0;
    const shown = guide.step === 3 && run.d < nextLog - 9 ? -1 : guide.step;
    publish(snapshot(run, outcome, shown, opening));
    hudDirty = false;
    sinceHud = 0;
  }
  if (first && sceneReady) {
    first = false;
    readyRaf = requestAnimationFrame(() => {
      if (disposed || failed) return;
      worldReady();
      if (visualApi) visualApi.ready = true;
    });
  }
}
raf = requestAnimationFrame(tick);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    disposed = true;
    cancelAnimationFrame(raf);
    cancelAnimationFrame(readyRaf);
    unbindKeyboard();
    window.removeEventListener("pointerdown", unlock, { capture: true });
    window.removeEventListener("keydown", onAudioKey);
    window.removeEventListener("keydown", onTitleKey);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVisibility);
    root?.unmount();
    visualApi?.dispose();
    cues.reset();
    audio.dispose();
    scene.dispose();
    canvas.remove();
  });
