import { createRun, type RunState, startHike } from "./game/run";
import { BOOKMARKS } from "./scene/bookmarks";
import { furUniforms } from "./scene/fur";
import type { GameScene } from "./scene/game-scene";

// Capture hook for visual evidence (docs/visual). Only installed in dev builds or with ?e2e in
// the URL. window.__VISUAL_TEST__ exposes: ready, bookmarks, renderer, setBookmark(name),
// clearBookmark(), freeze(on), settle(frames), run() (a read-only look at the hike, so browser
// tests can time their jumps like a player).

export const visual = { frozen: false, frames: 0, step: 0 };
const waiters: { n: number; done: () => void }[] = [];

export const visualTestEnabled = () =>
  import.meta.env.DEV || new URLSearchParams(window.location.search).has("e2e");

export interface VisualApi {
  ready: boolean;
  bookmarks: string[];
  renderer: string;
  setBookmark(name: string): boolean;
  clearBookmark(): void;
  /** The fur's live wetness uniforms (line, soak, splash, frizz). */
  wetness(): number[];
  /** Wet fur for evidence captures: soak line (m), soak, splash, frizz. */
  setWet(line: number, soak: number, splash?: number, frizz?: number): void;
  freeze(on?: boolean): void;
  settle(frames?: number): Promise<void>;
  /** While frozen, advance the next frame by dt seconds (films step time deterministically). */
  step(dt: number): Promise<void>;
  /** The hike so far: where the bear is and how it is going. */
  run(): {
    phase: string;
    d: number;
    speed: number;
    airborne: boolean;
    trips: number;
    bumps: number;
  };
}

export function installVisualTest(
  scene: GameScene,
  setRun: (r: RunState) => void,
  getRun: () => RunState,
): VisualApi {
  const gl = scene.stage.renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const api: VisualApi = {
    ready: false,
    bookmarks: Object.keys(BOOKMARKS),
    renderer: String(
      info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    ),
    setBookmark(name) {
      const b = BOOKMARKS[name];
      if (!b) return false;
      const r = createRun(b.load);
      startHike(r);
      r.d = b.d;
      r.speed = 0.9;
      r.stepPhase = 1.2;
      r.balance.tilt = b.tilt;
      setRun(r);
      scene.reset();
      scene.setShot(b);
      scene.setGaitPhase(1.1);
      if (b.wet) scene.setWet(...b.wet);
      document.documentElement.classList.add("visual-test");
      return true;
    },
    wetness() {
      return [
        furUniforms.uWetLine.value,
        furUniforms.uSoak.value,
        furUniforms.uSplash.value,
        furUniforms.uFrizz.value,
      ];
    },
    setWet(line, soak, splash = 0, frizz = 0) {
      scene.setWet(line, soak, splash, frizz);
    },
    clearBookmark() {
      scene.setShot(null);
      document.documentElement.classList.remove("visual-test");
    },
    freeze(on = true) {
      visual.frozen = on;
    },
    settle(frames = 12) {
      return new Promise((done) => waiters.push({ n: visual.frames + frames, done }));
    },
    step(dt) {
      visual.step = dt;
      return new Promise((done) => waiters.push({ n: visual.frames + 1, done }));
    },
    run() {
      const r = getRun();
      return {
        phase: r.phase,
        d: r.d,
        speed: r.speed,
        airborne: r.airborne,
        trips: r.trips,
        bumps: r.bumps,
      };
    },
  };
  (window as unknown as { __VISUAL_TEST__: VisualApi }).__VISUAL_TEST__ = api;
  return api;
}

/** Call once per rendered frame. */
export function visualFrame() {
  visual.frames++;
  for (let i = waiters.length - 1; i >= 0; i--) {
    const w = waiters[i];
    if (w && visual.frames >= w.n) {
      waiters.splice(i, 1);
      w.done();
    }
  }
}
