import type { ItemId } from "../game/items";
import { effectiveGrip, type LoadStats } from "../game/load";
import { fetchCost, type Phase, type RunState, totalTime } from "../game/run";
import type { TeaOutcome } from "../game/tea";
import { gustAt, LEDGE, TRAIL_LENGTH, toppleLimit, type Zone, zoneAt } from "../game/trail";

// A tiny external store the render loop publishes into and React reads from.

export interface HudState {
  phase: Phase;
  packed: ItemId[];
  stack: ItemId[];
  stats: LoadStats;
  tilt: number;
  lean: number;
  limit: number;
  /** The tilt at which the first item starts to slide. */
  safe: number;
  worstSlide: { id: ItemId; slide: number } | null;
  dropped: { id: ItemId; cost: number }[];
  time: number;
  progress: number;
  zone: Zone;
  gust: { dir: number; strength: number; warning: boolean } | null;
  busy: boolean;
  outcome: TeaOutcome | null;
  toast: { text: string; id: number } | null;
  hint: boolean;
  tally: { spills: number; fetches: number; topples: number };
}

let state: HudState | null = null;
const listeners = new Set<() => void>();
let toastId = 0;
let toast: HudState["toast"] = null;

export function snapshot(s: RunState, outcome: TeaOutcome | null, hint: boolean): HudState {
  let worst: HudState["worstSlide"] = null;
  s.slides.forEach((v, i) => {
    const id = s.stack[i];
    if (id && Math.abs(v) > 0.08 && (!worst || Math.abs(v) > Math.abs(worst.slide)))
      worst = { id, slide: v };
  });
  const grips = s.stack.map((_, i) => effectiveGrip(s.stack, i));
  const onLedge = s.phase === "hiking" && s.d >= LEDGE.from && s.d < LEDGE.to;
  return {
    phase: s.phase,
    packed: [...s.packed],
    stack: [...s.stack],
    stats: s.stats,
    tilt: s.balance.tilt,
    lean: s.balance.lean,
    limit: toppleLimit(s.d),
    safe: grips.length ? Math.min(...grips) : 0.4,
    worstSlide: worst,
    dropped: s.dropped.map((x) => ({ id: x.id, cost: fetchCost(s, x) })),
    time: totalTime(s),
    progress: s.d / TRAIL_LENGTH,
    zone: zoneAt(s.d),
    gust: onLedge ? gustAt(s.gustClock) : null,
    busy: s.busy > 0,
    outcome,
    toast,
    hint,
    tally: { spills: s.spills, fetches: s.fetches, topples: s.topples },
  };
}

export function publish(next: HudState) {
  state = next;
  for (const l of listeners) l();
}

export function showToast(text: string) {
  toast = { text, id: ++toastId };
}

export const store = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => state,
};
