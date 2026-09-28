import { type BalanceState, clamp, restingBalance, stepBalance } from "./balance";
import type { ItemId } from "./items";
import { effectiveGrip, type LoadStats, layoutStack, loadStats } from "./load";
import {
  CHECKPOINTS,
  curvatureAt,
  GUST_PERIOD,
  gustAt,
  LEDGE,
  LOGS,
  TRAIL_LENGTH,
  toppleLimit,
  zoneAt,
} from "./trail";

export type Phase = "packing" | "hiking" | "tea";

export interface Input {
  walk: boolean;
  lean: number;
}

export type RunEvent =
  | { type: "drop"; id: ItemId; side: number }
  | { type: "topple"; side: number }
  | { type: "checkpoint"; at: number }
  | { type: "log"; lurch: number }
  | { type: "fetch"; id: ItemId }
  | { type: "arrive" };

export interface Dropped {
  id: ItemId;
  at: number;
}

export interface RunState {
  phase: Phase;
  packed: ItemId[];
  stack: ItemId[];
  /** Per stack item: -1 … 1 how far it has slid; beyond ±1 it falls. */
  slides: number[];
  dropped: Dropped[];
  stats: LoadStats;
  balance: BalanceState;
  d: number;
  speed: number;
  time: number;
  penalty: number;
  /** Seconds the bear is busy (getting up, fetching) and cannot walk. */
  busy: number;
  checkpoint: { at: number; stack: ItemId[] };
  gustClock: number;
  logsPassed: number;
  stepPhase: number;
  topples: number;
  /** Items that slid off during the run, and how many were fetched back. */
  spills: number;
  fetches: number;
  events: RunEvent[];
}

export const MAX_STACK = 6;
export const TOPPLE_PENALTY = 4;
export const TOPPLE_BUSY = 1.8;
export const FETCH_BUSY = 1.2;
const SLIDE_RATE = 7;
const SLIDE_SETTLE = 0.5;
const GUST_TORQUE = 7;
const LOG_KICK = 1.7;
const CORNER_SWING = 2;

export function createRun(packed: ItemId[] = ["kettle", "teacups", "biscuits"]): RunState {
  const stack = [...packed];
  return {
    phase: "packing",
    packed: stack,
    stack: [...stack],
    slides: stack.map(() => 0),
    dropped: [],
    stats: loadStats(stack),
    balance: restingBalance(),
    d: 0,
    speed: 0,
    time: 0,
    penalty: 0,
    busy: 0,
    checkpoint: { at: 0, stack: [...stack] },
    gustClock: 0,
    logsPassed: 0,
    stepPhase: 0,
    topples: 0,
    spills: 0,
    fetches: 0,
    events: [],
  };
}

function setStack(s: RunState, stack: ItemId[]) {
  s.stack = stack;
  s.slides = stack.map(() => 0);
  s.stats = loadStats(stack);
}

/** Packing: add an item to the top, or remove it if already packed. */
export function togglePack(s: RunState, id: ItemId): void {
  if (s.phase !== "packing") return;
  const i = s.packed.indexOf(id);
  if (i >= 0) s.packed.splice(i, 1);
  else if (s.packed.length < MAX_STACK) s.packed.push(id);
  setStack(s, [...s.packed]);
}

/** Packing: move the item at `index` up (+1, toward the top) or down (-1). */
export function movePacked(s: RunState, index: number, dir: 1 | -1): void {
  if (s.phase !== "packing") return;
  const j = index + dir;
  const a = s.packed[index];
  const b = s.packed[j];
  if (a === undefined || b === undefined) return;
  s.packed[index] = b;
  s.packed[j] = a;
  setStack(s, [...s.packed]);
}

export function startHike(s: RunState): void {
  const packed = [...s.packed];
  Object.assign(s, createRun(packed), { phase: "hiking" as Phase });
}

export function fetchCost(s: RunState, drop: Dropped): number {
  return Math.round(3 + 0.12 * Math.max(0, s.d - drop.at));
}

/** Trot back for a dropped item: it returns to the top of the stack after a time cost. */
export function fetchItem(s: RunState, id: ItemId): boolean {
  if (s.phase !== "hiking" || s.busy > 0) return false;
  const i = s.dropped.findIndex((x) => x.id === id);
  const drop = s.dropped[i];
  if (!drop) return false;
  s.dropped.splice(i, 1);
  s.penalty += fetchCost(s, drop);
  setStack(s, [...s.stack, id]);
  s.balance = restingBalance();
  s.speed = 0;
  s.busy = FETCH_BUSY;
  s.fetches += 1;
  s.events.push({ type: "fetch", id });
  return true;
}

export const totalTime = (s: RunState) => s.time + s.penalty;

export function stepRun(s: RunState, input: Input, dt: number): void {
  if (s.phase !== "hiking") return;
  s.time += dt;
  if (s.busy > 0) {
    s.busy = Math.max(0, s.busy - dt);
    s.speed = 0;
    return;
  }

  const target = input.walk ? s.stats.maxSpeed : 0;
  s.speed += clamp(target - s.speed, -4 * dt, 2.4 * dt);
  const prevD = s.d;
  s.d += s.speed * dt;
  s.stepPhase += s.speed * dt * 3.4;

  // Forces from the trail.
  const lateral = CORNER_SWING * s.speed * s.speed * curvatureAt(s.d);
  let torque = 0.35 * s.stats.mass * Math.sin(s.stepPhase) * Math.min(1, s.speed);
  if (s.d >= LEDGE.from && s.d < LEDGE.to) {
    s.gustClock += dt;
    const g = gustAt(s.gustClock);
    torque += g.dir * g.strength * GUST_TORQUE * (0.3 + s.stats.height);
  } else if (s.d < LEDGE.from) {
    s.gustClock = 0;
  }
  s.balance = stepBalance(s.balance, s.stats, { lean: input.lean, lateral, torque }, dt);

  const log = LOGS[s.logsPassed];
  if (log && prevD < log.at && s.d >= log.at) {
    s.logsPassed += 1;
    s.balance.spin +=
      (log.lurch * LOG_KICK * s.speed * s.stats.comHeight) / Math.sqrt(s.stats.inertia);
    s.events.push({ type: "log", lurch: log.lurch });
  }

  for (const c of CHECKPOINTS) {
    if (prevD < c && s.d >= c) {
      s.checkpoint = { at: c, stack: [...s.stack] };
      s.events.push({ type: "checkpoint", at: c });
    }
  }

  if (Math.abs(s.balance.tilt) > toppleLimit(s.d)) {
    topple(s);
    return;
  }
  slideItems(s, dt);

  if (s.d >= TRAIL_LENGTH) {
    s.d = TRAIL_LENGTH;
    s.phase = "tea";
    s.events.push({ type: "arrive" });
  }
}

function slideItems(s: RunState, dt: number) {
  const tilt = s.balance.tilt;
  const layout = layoutStack(s.stack);
  const keep: ItemId[] = [];
  const keptSlides: number[] = [];
  let lost = false;
  for (let i = 0; i < s.stack.length; i++) {
    const id = s.stack[i] as ItemId;
    // Higher items feel the tilt a little more.
    const height = (layout[i]?.center ?? 0.5) - 0.5;
    const excess = Math.abs(tilt) * (1 + 0.12 * height) - effectiveGrip(s.stack, i);
    let slide = s.slides[i] ?? 0;
    if (excess > 0) slide += Math.sign(tilt) * excess * SLIDE_RATE * dt;
    else slide -= Math.sign(slide) * Math.min(Math.abs(slide), SLIDE_SETTLE * dt);
    if (Math.abs(slide) >= 1) {
      s.dropped.push({ id, at: s.d });
      s.spills += 1;
      s.events.push({ type: "drop", id, side: Math.sign(slide) });
      lost = true;
    } else {
      keep.push(id);
      keptSlides.push(slide);
    }
  }
  if (lost) {
    s.stack = keep;
    s.stats = loadStats(keep);
  }
  s.slides = keptSlides;
}

function topple(s: RunState) {
  const side = Math.sign(s.balance.tilt) || 1;
  s.topples += 1;
  s.penalty += TOPPLE_PENALTY;
  // Anything lost since the checkpoint comes back: the checkpoint remembers the load.
  const back = s.checkpoint.stack;
  s.dropped = s.dropped.filter((x) => !back.includes(x.id));
  setStack(s, [...back]);
  s.d = s.checkpoint.at;
  s.speed = 0;
  s.balance = restingBalance();
  s.logsPassed = LOGS.filter((l) => l.at <= s.d).length;
  s.gustClock = s.d >= LEDGE.from ? GUST_PERIOD * 0.5 : 0;
  s.busy = TOPPLE_BUSY;
  s.events.push({ type: "topple", side });
}

export function drainEvents(s: RunState): RunEvent[] {
  const out = s.events;
  s.events = [];
  return out;
}

export const zoneOf = (s: RunState) => zoneAt(s.d);
