import type { ItemId } from "./items";
import { PACK_TOP } from "./load";
import { GREEN, LANE, ORCHARD } from "./trail";

// The trail's three comic obstacles, as pure functions of time and distance.
//
// The village green: people glued to their phones wander across the path on fixed routes. Each
// route is a function of run time, so the scene shows exactly what the rules test. Walk into one
// and the stack gets a shove and the bear an apologetic stop; wait for a gap and you pass clean.
//
// The orchard: low branches reach over the path from alternating sides. A stack whose top rises
// above a branch and sits on its side of the path loses its top item. Leaning away tips the top
// clear; short stacks pass underneath.
//
// The goose: it guards the lane. Enter and it gives chase at a brisk waddle. Let it catch up and
// it pecks at the load; and it takes the biscuits if you packed them.
//
// Positions are in the path's own frame: `d` along the trail, `x` sideways (positive right).

/** Hip pivot height of the bear above the path (matches the scene's HIP_HEIGHT). */
export const HIP = 0.42;

// ---- the crowd -------------------------------------------------------------------------------
export type Behaviour = "cross" | "stroll" | "stand";

export interface Walker {
  /** Where on the trail the route sits. */
  d: number;
  /** Crossers: sideways extent either side of the path; strollers: their lane. */
  x: number;
  /** Stroll length along the trail (strollers only). */
  length: number;
  speed: number;
  /** Seconds lingering at each end (phone in hand). */
  pause: number;
  /** Seconds offset into the route at run start. */
  phase: number;
  behaviour: Behaviour;
  /** Index into the scene's character models. */
  look: number;
}

export const CROWD: Walker[] = [
  { d: 75.5, x: 5.5, length: 0, speed: 0.7, pause: 1.6, phase: 3, behaviour: "cross", look: 0 },
  { d: 78.5, x: 4.5, length: 0, speed: 0.85, pause: 0.8, phase: 9, behaviour: "cross", look: 1 },
  { d: 81.5, x: 6, length: 0, speed: 0.65, pause: 2.2, phase: 1, behaviour: "cross", look: 2 },
  { d: 84.5, x: 4, length: 0, speed: 0.95, pause: 0.6, phase: 6, behaviour: "cross", look: 3 },
  { d: 87.5, x: 5, length: 0, speed: 0.75, pause: 1.4, phase: 12, behaviour: "cross", look: 4 },
  { d: 90, x: 3.5, length: 0, speed: 0.6, pause: 2.8, phase: 4, behaviour: "cross", look: 5 },
  { d: 92.5, x: 5.5, length: 0, speed: 0.9, pause: 1, phase: 15, behaviour: "cross", look: 6 },
  { d: 95.5, x: 4.5, length: 0, speed: 0.7, pause: 1.8, phase: 7, behaviour: "cross", look: 7 },
  { d: 98.5, x: 6, length: 0, speed: 0.8, pause: 1.2, phase: 2, behaviour: "cross", look: 8 },
  { d: 101.5, x: 4, length: 0, speed: 0.65, pause: 2, phase: 10, behaviour: "cross", look: 9 },
  { d: 80, x: -1.6, length: 16, speed: 0.55, pause: 2, phase: 5, behaviour: "stroll", look: 10 },
  { d: 88, x: 1.7, length: 12, speed: 0.5, pause: 3, phase: 0, behaviour: "stroll", look: 11 },
  { d: 83, x: 1.35, length: 0, speed: 0, pause: 0, phase: 0, behaviour: "stand", look: 12 },
  { d: 96.5, x: -1.4, length: 0, speed: 0, pause: 0, phase: 0, behaviour: "stand", look: 13 },
];

export interface WalkerPose {
  d: number;
  x: number;
  /** Heading in the path frame: 0 along the trail, +π/2 walking toward +x. */
  heading: number;
  moving: boolean;
}

/** Ping-pong along a segment of length `span` at `speed`, lingering `pause` at each end. */
function pingPong(t: number, span: number, speed: number, pause: number) {
  const leg = span / speed;
  const cycle = 2 * (leg + pause);
  const u = ((t % cycle) + cycle) % cycle;
  if (u < leg) return { s: (u / leg) * span, dir: 1, moving: true };
  if (u < leg + pause) return { s: span, dir: 1, moving: false };
  if (u < 2 * leg + pause)
    return { s: span - ((u - leg - pause) / leg) * span, dir: -1, moving: true };
  return { s: 0, dir: -1, moving: false };
}

export function walkerAt(w: Walker, time: number): WalkerPose {
  if (w.behaviour === "stand")
    return { d: w.d, x: w.x, heading: w.x > 0 ? -Math.PI / 2 : Math.PI / 2, moving: false };
  if (w.behaviour === "stroll") {
    const p = pingPong(time + w.phase, w.length, w.speed, w.pause);
    return { d: w.d + p.s, x: w.x, heading: p.dir > 0 ? 0 : Math.PI, moving: p.moving };
  }
  const p = pingPong(time + w.phase, 2 * w.x, w.speed, w.pause);
  // A slight diagonal: nobody looking at a phone walks a straight line.
  const x = p.s - w.x;
  return {
    d: w.d + Math.sin((p.s / (2 * w.x)) * Math.PI) * 0.6,
    x,
    heading: p.dir > 0 ? Math.PI / 2 : -Math.PI / 2,
    moving: p.moving,
  };
}

/** Radius within which a walker and the bear collide. */
export const BUMP_RADIUS = 0.62;
/** Seconds before the same walker can bump again. */
export const BUMP_COOLDOWN = 3;

/** Walkers the bear (at trail distance d) is touching now, with the side each pushes toward. */
export function bumpsAt(d: number, time: number): { who: number; side: number }[] {
  if (d < GREEN.from - 2 || d > GREEN.to + 2) return [];
  const out: { who: number; side: number }[] = [];
  CROWD.forEach((w, who) => {
    const p = walkerAt(w, time);
    if (Math.hypot(p.d - d, p.x) < BUMP_RADIUS) {
      // They walk into you: the push goes their way (or away from them if they stand still).
      const side =
        p.moving && w.behaviour === "cross"
          ? Math.sign(Math.sin(p.heading)) || 1
          : -Math.sign(p.x) || 1;
      out.push({ who, side });
    }
  });
  return out;
}

// ---- the orchard -----------------------------------------------------------------------------
export interface Branch {
  at: number;
  /** Which side of the path it grows from (-1 left, 1 right). */
  side: number;
  /** Height of its lowest leaves above the path. */
  height: number;
}

export const BRANCHES: Branch[] = [
  { at: ORCHARD.from + 4, side: 1, height: 1.48 },
  { at: ORCHARD.from + 9, side: -1, height: 1.44 },
  { at: ORCHARD.from + 13.5, side: 1, height: 1.4 },
  { at: ORCHARD.from + 18, side: -1, height: 1.46 },
  { at: ORCHARD.from + 22.5, side: 1, height: 1.42 },
];
/** How far past the centre line a branch reaches (metres). */
export const BRANCH_REACH = 0.12;

/** Height of the top of the stack above the path, and where it sits sideways. */
export function stackTop(stackHeight: number, tilt: number) {
  const r = PACK_TOP + stackHeight;
  return { y: HIP + Math.cos(tilt) * r, x: Math.sin(tilt) * r };
}

/** Whether a branch catches the top of the stack. */
export function branchCatches(b: Branch, stackHeight: number, tilt: number, feetHeight = 0) {
  if (stackHeight <= 0) return false;
  const top = stackTop(stackHeight, tilt);
  return top.y + feetHeight > b.height && b.side * top.x > -BRANCH_REACH;
}

// ---- the goose -------------------------------------------------------------------------------
export const GOOSE = {
  /** It notices you here and starts behind you by `start` metres. */
  wake: LANE.from + 3,
  start: 6.5,
  speed: 1.32,
  accel: 1.4,
  /** Close enough to peck, and seconds between pecks. */
  reach: 0.95,
  peckEvery: 1.1,
  /** It gives up at the far gate. */
  quit: LANE.to,
};

export interface GooseState {
  state: "asleep" | "chasing" | "done";
  d: number;
  speed: number;
  peckIn: number;
}

export const sleepingGoose = (): GooseState => ({
  state: "asleep",
  d: GOOSE.wake - GOOSE.start,
  speed: 0,
  peckIn: 0,
});

export type GooseEvent =
  | { type: "honk" }
  | { type: "peck"; side: number }
  | { type: "steal"; id: ItemId }
  | { type: "quit" };

/** Advance the goose; returns what it did. `stack` may be edited (it steals the biscuits). */
export function stepGoose(
  g: GooseState,
  bearD: number,
  stack: ItemId[],
  dt: number,
  rand: () => number,
): GooseEvent[] {
  const out: GooseEvent[] = [];
  if (g.state === "asleep") {
    if (bearD >= GOOSE.wake) {
      g.state = "chasing";
      g.d = bearD - GOOSE.start;
      g.speed = 0;
      g.peckIn = GOOSE.peckEvery * 0.5;
      out.push({ type: "honk" });
    }
    return out;
  }
  if (g.state === "done") return out;
  if (bearD >= GOOSE.quit) {
    g.state = "done";
    out.push({ type: "quit" });
    return out;
  }
  g.speed = Math.min(GOOSE.speed, g.speed + GOOSE.accel * dt);
  g.d = Math.min(bearD - 0.5, g.d + g.speed * dt);
  if (bearD - g.d <= GOOSE.reach) {
    g.peckIn -= dt;
    if (g.peckIn <= 0) {
      g.peckIn = GOOSE.peckEvery;
      const biscuits = stack.indexOf("biscuits");
      if (biscuits >= 0) {
        stack.splice(biscuits, 1);
        out.push({ type: "steal", id: "biscuits" });
      } else out.push({ type: "peck", side: rand() < 0.5 ? -1 : 1 });
    }
  } else g.peckIn = Math.min(g.peckIn, GOOSE.peckEvery * 0.5);
  return out;
}
