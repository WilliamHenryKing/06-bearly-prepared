import type { ItemId } from "../game/items";
import { effectiveGrip, type LoadStats } from "../game/load";
import { fetchCost, type Phase, type RunState, totalTime } from "../game/run";
import type { TeaOutcome } from "../game/tea";
import { gustAt, LEDGE, LOGS, TRAIL_LENGTH, toppleLimit, type Zone, zoneAt } from "../game/trail";

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
  nextLogDistance: number | null;
  zone: Zone;
  gust: { dir: number; strength: number; warning: boolean } | null;
  busy: boolean;
  outcome: TeaOutcome | null;
  toast: { text: string; id: number } | null;
  /** The guided first minute's step showing (-1: none). */
  guide: number;
  /** The opening: title card, the glide down to the bear, then packing. */
  opening: "title" | "glide" | "done";
  tally: { spills: number; fetches: number; topples: number; trips: number };
}

let state: HudState | null = null;
const listeners = new Set<() => void>();
let toastId = 0;
let toast: HudState["toast"] = null;

export function snapshot(
  s: RunState,
  outcome: TeaOutcome | null,
  guide: number,
  opening: HudState["opening"],
): HudState {
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
    nextLogDistance: LOGS[s.logsPassed] ? (LOGS[s.logsPassed]?.at ?? 0) - s.d : null,
    zone: zoneAt(s.d),
    gust: onLedge ? gustAt(s.gustClock) : null,
    busy: s.busy > 0 || s.airborne,
    outcome,
    toast,
    guide,
    opening,
    tally: { spills: s.spills, fetches: s.fetches, topples: s.topples, trips: s.trips },
  };
}

export function publish(next: HudState) {
  state = next;
  for (const l of listeners) l();
}

export function showToast(text: string) {
  toast = { text, id: ++toastId };
}

export function clearToast() {
  toast = null;
}

export const store = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => state,
};
