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
  dispose(): void;
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
  /** The quality tier and how far the frame-time governor has stepped it down. */
  quality(): Record<string, unknown>;
  /** Hide scene roots by index, to measure what each costs; returns the roots. */
  hide(roots: number[]): string[];
  /** Take one governor step down, as a slow frame run would (false when nothing is left). */
  degrade(): boolean;
  /** Draw calls per frame by what draws them (visible meshes, points and lines), heaviest first. */
  census(): { draws: number; top: [string, number, number][]; roots: [string, number][] };
  /** The hike so far: where the bear is and how it is going. */
  run(): {
    phase: string;
    d: number;
    speed: number;
    airborne: boolean;
    trips: number;
    bumps: number;
    logsPassed: number;
    topples: number;
    busy: number;
    stack: string[];
    packed: string[];
    dropped: string[];
  };
}

export function installVisualTest(
  scene: GameScene,
  setRun: (r: RunState) => void,
  getRun: () => RunState,
  restoreLayout: () => void = () => {},
): VisualApi {
  const gl = scene.stage.renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  let disposed = false;
  visual.frozen = false;
  visual.step = 0;
  const api: VisualApi = {
    ready: false,
    dispose() {
      if (disposed) return;
      disposed = true;
      api.ready = false;
      visual.frozen = false;
      visual.step = 0;
      for (const waiter of waiters.splice(0)) waiter.done();
      document.documentElement.classList.remove("visual-test");
      const host = window as unknown as { __VISUAL_TEST__?: VisualApi };
      if (host.__VISUAL_TEST__ === api) delete host.__VISUAL_TEST__;
    },
    bookmarks: Object.keys(BOOKMARKS),
    renderer: String(
      info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    ),
    setBookmark(name) {
      const b = BOOKMARKS[name];
      if (disposed || !b) return false;
      const r = createRun(b.load);
      startHike(r);
      r.d = b.d;
      r.speed = 0.9;
      r.stepPhase = 1.2;
      r.balance.tilt = b.tilt;
      setRun(r);
      scene.reset();
      scene.stage.camera.zoom = 1;
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
      if (disposed) return;
      scene.setWet(line, soak, splash, frizz);
    },
    clearBookmark() {
      if (disposed) return;
      scene.setShot(null);
      document.documentElement.classList.remove("visual-test");
      restoreLayout();
    },
    freeze(on = true) {
      if (disposed) return;
      visual.frozen = on;
    },
    settle(frames = 12) {
      if (disposed) return Promise.resolve();
      const count = Number.isFinite(frames) ? Math.max(1, Math.floor(frames)) : 12;
      return new Promise((done) => waiters.push({ n: visual.frames + count, done }));
    },
    step(dt) {
      if (disposed) return Promise.resolve();
      visual.step = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
      return new Promise((done) => waiters.push({ n: visual.frames + 1, done }));
    },
    quality() {
      return scene.stage.state;
    },
    hide(roots: number[]) {
      if (disposed) return [];
      const kids = scene.stage.scene.children;
      for (const i of roots) {
        const o = kids[i];
        if (o) o.visible = false;
      }
      return kids.map((o, i) => `${i} ${o.name || o.type}`);
    },
    degrade() {
      if (disposed) return false;
      return scene.stage.degrade();
    },
    census() {
      // Each visible drawable costs one draw per material group; name it by the nearest named
      // ancestor so a family of meshes sums together.
      const byName = new Map<string, [number, number]>();
      const byRoot = new Map<string, number>();
      const top = scene.stage.scene;
      let draws = 0;
      scene.stage.scene.traverseVisible((o) => {
        const m = o as unknown as {
          isMesh?: boolean;
          isPoints?: boolean;
          isLine?: boolean;
          material?: unknown;
          geometry?: { groups: unknown[] };
        };
        if (!(m.isMesh || m.isPoints || m.isLine)) return;
        const n = Array.isArray(m.material) ? (m.geometry?.groups.length ?? 1) : 1;
        let p: typeof o | null = o;
        while (p && !p.name) p = p.parent;
        const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as
          | { name?: string; type?: string }
          | undefined;
        const geo = m.geometry as unknown as {
          type?: string;
          attributes?: { position?: { count: number } };
        };
        const key =
          p?.name ||
          `${o.type} · ${mat?.name || mat?.type} · ${geo?.type} ${geo?.attributes?.position?.count ?? 0}v`;
        const row = byName.get(key) ?? [0, 0];
        row[0] += n;
        row[1] += 1;
        byName.set(key, row);
        let r: typeof o = o;
        while (r.parent && r.parent !== top) r = r.parent;
        const where = `${top.children.indexOf(r)} ${r.name || r.type}`;
        byRoot.set(where, (byRoot.get(where) ?? 0) + n);
        draws += n;
      });
      const heaviest = [...byName.entries()]
        .map(([k, [d, c]]) => [k, d, c] as [string, number, number])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25);
      const roots = [...byRoot.entries()].sort((a, b) => b[1] - a[1]);
      return { draws, top: heaviest, roots };
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
        logsPassed: r.logsPassed,
        topples: r.topples,
        busy: r.busy,
        stack: [...r.stack],
        packed: [...r.packed],
        dropped: r.dropped.map((x) => x.id),
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
