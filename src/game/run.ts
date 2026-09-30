import { type BalanceState, clamp, GRAVITY, restingBalance, stepBalance } from "./balance";
import type { ItemId } from "./items";
import { effectiveGrip, type LoadStats, layoutStack, loadStats } from "./load";
import {
  BRANCHES,
  BUMP_COOLDOWN,
  branchCatches,
  bumpsAt,
  CROWD,
  GOOSE,
  type GooseState,
  sleepingGoose,
  stepGoose,
} from "./obstacles";
import {
  CHECKPOINTS,
  camberAt,
  curvatureAt,
  GUST_PERIOD,
  gustAt,
  LEDGE,
  LOG_HALF,
  LOG_TOP,
  LOGS,
  TRAIL_LENGTH,
  toppleLimit,
  zoneAt,
} from "./trail";

export type Phase = "packing" | "hiking" | "tea";

export interface Input {
  walk: boolean;
  lean: number;
  /** Held: a jump starts on the press. */
  jump?: boolean;
}

export type RunEvent =
  | { type: "drop"; id: ItemId; side: number }
  | { type: "topple"; side: number }
  | { type: "trip"; at: number }
  | { type: "jump" }
  | { type: "land"; strength: number; lurch: number }
  | { type: "checkpoint"; at: number }
  | { type: "log"; lurch: number }
  | { type: "fetch"; id: ItemId }
  | { type: "bump"; who: number; side: number }
  | { type: "branch"; at: number; side: number; hit: ItemId | null }
  | { type: "goose"; kind: "honk" | "peck" | "steal" | "quit"; side?: number }
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
  /** Seconds before each walker on the green can bump into the bear again. */
  crowdCooldown: number[];
  bumps: number;
  branchesPassed: number;
  goose: GooseState;
  /** Taken by the goose: not fetchable, but a fall can restore a flag's saved load. */
  stolen: ItemId[];
  /** Feet above the path, and vertical speed, while jumping. */
  y: number;
  vy: number;
  airborne: boolean;
  jumpHeld: boolean;
  /** The side the next landing lurches toward (the log just cleared), or 0. */
  pendingLurch: number;
  trips: number;
  seed: number;
  events: RunEvent[];
}

export const MAX_STACK = 6;
export const TOPPLE_PENALTY = 4;
export const TOPPLE_BUSY = 1.8;
export const FETCH_BUSY = 1.2;
const SLIDE_RATE = 7;
const SLIDE_SETTLE = 0.5;
const GUST_TORQUE = 7;

const CORNER_SWING = 2;
/** A walker's shove, and a goose's peck, as a spin kick scaled like a log's. */
const BUMP_KICK = 1.25;
const PECK_KICK = 0.7;
/** Seconds the bear stands apologising after bumping into someone. */
const BUMP_STOP = 0.45;
/** Take-off speed of a jump (m/s): enough to clear a log with a sensible load. */
export const JUMP_SPEED = 3.1;
/** Spin kick of a hard landing. */
const LAND_KICK = 1.5;
/** How strongly a cross-slope pulls the load downhill. */
const CAMBER_GAIN = 1.1;

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
    crowdCooldown: CROWD.map(() => 0),
    bumps: 0,
    branchesPassed: 0,
    goose: sleepingGoose(),
    stolen: [],
    y: 0,
    vy: 0,
    airborne: false,
    jumpHeld: false,
    pendingLurch: 0,
    trips: 0,
    seed: 20260928,
    events: [],
  };
}

function rand(s: RunState) {
  s.seed = (s.seed * 16807) % 2147483647;
  return (s.seed - 1) / 2147483646;
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
  if (s.phase !== "packing") return;
  const packed = [...s.packed];
  Object.assign(s, createRun(packed), { phase: "hiking" as Phase });
}

export function fetchCost(s: RunState, drop: Dropped): number {
  return Math.round(3 + 0.12 * Math.max(0, s.d - drop.at));
}

/** Trot back for a dropped item: it returns to the top of the stack after a time cost. */
export function fetchItem(s: RunState, id: ItemId): boolean {
  if (s.phase !== "hiking" || s.busy > 0 || s.airborne) return false;
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
  const jumpPressed = !!input.jump && !s.jumpHeld;
  s.jumpHeld = !!input.jump;
  if (s.busy > 0) {
    s.busy = Math.max(0, s.busy - dt);
    s.speed = 0;
    return;
  }

  // A jump starts on the press (not while held); in the air the bear keeps its speed.
  if (jumpPressed && !s.airborne) {
    s.airborne = true;
    s.vy = JUMP_SPEED * (1 - 0.18 * s.stats.wobble);
    s.events.push({ type: "jump" });
  }
  if (!s.airborne) {
    const target = input.walk ? s.stats.maxSpeed : 0;
    s.speed += clamp(target - s.speed, -4 * dt, 2.4 * dt);
  }
  const prevD = s.d;
  s.d += s.speed * dt;
  if (!s.airborne) s.stepPhase += s.speed * dt * 3.4;
  let torque = 0;
  if (s.airborne) {
    s.vy -= GRAVITY * dt;
    s.y += s.vy * dt;
    if (s.y <= 0) {
      // Landing jolts the load: harder from higher, and sideways where the ground is uneven.
      const hit = Math.min(1.4, -s.vy / 2.5);
      const side = s.pendingLurch || (rand(s) < 0.5 ? -1 : 1);
      s.balance.spin += (side * LAND_KICK * hit * s.stats.comHeight) / Math.sqrt(s.stats.inertia);
      s.events.push({ type: "land", strength: hit, lurch: s.pendingLurch });
      s.pendingLurch = 0;
      s.y = 0;
      s.vy = 0;
      s.airborne = false;
    }
  }

  // Logs: the bear's feet must be above a log's top all the way across it.
  const log = LOGS[s.logsPassed];
  if (log) {
    const over = s.d + LOG_HALF > log.at && s.d - LOG_HALF < log.at;
    if (over && s.y < LOG_TOP) {
      trip(s, log.at);
      return;
    }
    if (s.d - LOG_HALF >= log.at) {
      s.logsPassed += 1;
      s.pendingLurch = log.lurch;
      s.events.push({ type: "log", lurch: log.lurch });
    }
  }

  // Forces from the trail: cornering throws the load outward, a cross-slope pulls it downhill.
  const lateral =
    CORNER_SWING * s.speed * s.speed * curvatureAt(s.d) +
    GRAVITY * Math.sin(camberAt(s.d)) * CAMBER_GAIN;
  if (!s.airborne) torque += 0.35 * s.stats.mass * Math.sin(s.stepPhase) * Math.min(1, s.speed);
  if (s.d >= LEDGE.from && s.d < LEDGE.to) {
    s.gustClock += dt;
    const g = gustAt(s.gustClock);
    torque += g.dir * g.strength * GUST_TORQUE * (0.3 + s.stats.height);
  } else if (s.d < LEDGE.from) {
    s.gustClock = 0;
  }
  s.balance = stepBalance(s.balance, s.stats, { lean: input.lean, lateral, torque }, dt);

  // The village green: people walking into the bear.
  for (let i = 0; i < s.crowdCooldown.length; i++)
    s.crowdCooldown[i] = Math.max(0, (s.crowdCooldown[i] as number) - dt);
  for (const b of bumpsAt(s.d, s.time)) {
    if ((s.crowdCooldown[b.who] as number) > 0) continue;
    s.crowdCooldown[b.who] = BUMP_COOLDOWN;
    s.balance.spin += (b.side * BUMP_KICK * s.stats.comHeight) / Math.sqrt(s.stats.inertia);
    s.speed = 0;
    s.busy = Math.max(s.busy, BUMP_STOP);
    s.bumps += 1;
    s.events.push({ type: "bump", who: b.who, side: b.side });
  }

  // The orchard: a branch knocks the top item off a stack that reaches into it.
  const branch = BRANCHES[s.branchesPassed];
  if (branch && prevD < branch.at && s.d >= branch.at) {
    s.branchesPassed += 1;
    let hit: ItemId | null = null;
    if (branchCatches(branch, s.stats.height, s.balance.tilt, s.y)) {
      hit = s.stack[s.stack.length - 1] ?? null;
      if (hit) {
        setStack(s, s.stack.slice(0, -1));
        s.dropped.push({ id: hit, at: s.d });
        s.spills += 1;
        s.events.push({ type: "drop", id: hit, side: -branch.side });
      }
    }
    s.events.push({ type: "branch", at: branch.at, side: branch.side, hit });
  }

  // The goose.
  const stack = [...s.stack];
  for (const e of stepGoose(s.goose, s.d, stack, dt, () => rand(s))) {
    if (e.type === "steal") {
      setStack(s, stack);
      s.stolen.push(e.id);
      s.events.push({ type: "goose", kind: "steal" });
    } else if (e.type === "peck") {
      s.balance.spin += (e.side * PECK_KICK * s.stats.comHeight) / Math.sqrt(s.stats.inertia);
      s.events.push({ type: "goose", kind: "peck", side: e.side });
    } else s.events.push({ type: "goose", kind: e.type });
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

/** Clipping a log: the bear pitches forward onto its face and the load collapses. */
function trip(s: RunState, at: number) {
  s.trips += 1;
  s.events.push({ type: "trip", at });
  fallBack(s);
}

function topple(s: RunState) {
  const side = Math.sign(s.balance.tilt) || 1;
  s.topples += 1;
  s.events.push({ type: "topple", side });
  fallBack(s);
}

/** After a fall: back to the last flag with the load it saw, a time penalty and a moment to rise. */
function fallBack(s: RunState) {
  s.penalty += TOPPLE_PENALTY;
  // Anything lost since the checkpoint comes back: the checkpoint remembers the load.
  const back = s.checkpoint.stack;
  // A fetched item absent from that saved load must remain in the world after the rewind.
  for (const id of s.stack) {
    if (back.includes(id)) continue;
    s.dropped.push({ id, at: s.d });
    s.spills += 1;
    s.events.push({ type: "drop", id, side: Math.sign(s.balance.tilt) || 1 });
  }
  s.dropped = s.dropped.filter((x) => !back.includes(x.id));
  s.stolen = s.stolen.filter((id) => !back.includes(id));
  setStack(s, [...back]);
  s.d = s.checkpoint.at;
  s.speed = 0;
  s.balance = restingBalance();
  s.logsPassed = LOGS.filter((l) => l.at <= s.d).length;
  s.branchesPassed = BRANCHES.filter((b) => b.at <= s.d).length;
  s.crowdCooldown = CROWD.map(() => 0);
  // Back before the goose's lane, the goose settles down again; past it, it stays gone.
  s.goose = sleepingGoose();
  if (s.d >= GOOSE.quit) s.goose.state = "done";
  s.gustClock = s.d >= LEDGE.from ? GUST_PERIOD * 0.5 : 0;
  s.busy = TOPPLE_BUSY;
  s.y = 0;
  s.vy = 0;
  s.airborne = false;
  s.pendingLurch = 0;
}

export function drainEvents(s: RunState): RunEvent[] {
  const out = s.events;
  s.events = [];
  return out;
}

export const zoneOf = (s: RunState) => zoneAt(s.d);
