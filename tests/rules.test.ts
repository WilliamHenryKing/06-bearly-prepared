import { describe, expect, test } from "bun:test";
import { restingBalance, stepBalance } from "../src/game/balance";
import type { ItemId } from "../src/game/items";
import { effectiveGrip, layoutStack, loadStats, PACK_TOP } from "../src/game/load";
import {
  BRANCHES,
  BUMP_RADIUS,
  branchCatches,
  CROWD,
  GOOSE,
  sleepingGoose,
  stepGoose,
  walkerAt,
} from "../src/game/obstacles";
import {
  createRun,
  drainEvents,
  fetchCost,
  fetchItem,
  type Input,
  JUMP_SPEED,
  movePacked,
  type RunState,
  startHike,
  stepRun,
  togglePack,
  totalTime,
} from "../src/game/run";
import { teaOutcome } from "../src/game/tea";
import {
  camberAt,
  GREEN,
  gustAt,
  LANE,
  LOGS,
  lastCheckpoint,
  pointAt,
  samplePath,
  TRAIL_LENGTH,
  toppleLimit,
  zoneAt,
} from "../src/game/trail";

const DT = 1 / 60;
const clampLean = (v: number) => Math.max(-1, Math.min(1, v));

/** Jump so the top of the arc comes over the next log. */
function jumpFor(s: RunState) {
  const log = LOGS[s.logsPassed];
  if (!log || s.airborne) return false;
  const gap = log.at - s.d;
  const peak = (JUMP_SPEED * (1 - 0.18 * s.stats.wobble)) / 9.8;
  return gap > 0 && gap <= Math.max(0.3, s.speed * peak) + 0.02;
}

const steady = (s: RunState): Input => ({
  walk: true,
  lean: clampLean(-(3 * s.balance.tilt + 0.9 * s.balance.spin)),
  jump: jumpFor(s),
});

/** Whether anyone on the green would be within reach of trail distance d in the next second. */
function crowded(time: number, d: number) {
  for (const w of CROWD)
    for (let t = 0; t <= 1.2; t += 0.15) {
      const p = walkerAt(w, time + t);
      if (Math.hypot(p.d - d, p.x) < BUMP_RADIUS + 0.3) return true;
    }
  return false;
}

/**
 * A careful hiker: steadies the load, jumps the logs, tips the stack away from the next low
 * branch, and on the green walks on only when the way ahead is clear (or when standing still
 * would be worse).
 */
const careful = (s: RunState): Input => {
  const next = BRANCHES.find((b) => b.at > s.d - 0.2);
  const target = next && next.at - s.d < 3 ? -next.side * 0.19 : 0;
  const lean = clampLean(3 * (target - s.balance.tilt) - 0.9 * s.balance.spin + target * 2);
  let walk = true;
  if (s.d > GREEN.from - 3 && s.d < GREEN.to + 1) {
    const ahead = s.d + Math.max(0.6, s.speed) * 0.8;
    walk = !crowded(s.time, ahead) || crowded(s.time, s.d);
  }
  return { walk, lean, jump: jumpFor(s) };
};

function hike(s: RunState, policy: (s: RunState) => Input, seconds = 300) {
  const events = [];
  for (let t = 0; t < seconds && s.phase === "hiking"; t += DT) {
    stepRun(s, policy(s), DT);
    events.push(...drainEvents(s));
  }
  return events;
}

describe("load", () => {
  test("stack layout starts on the pack and accumulates heights", () => {
    const l = layoutStack(["kettle", "biscuits"]);
    expect(l[0]?.bottom).toBe(PACK_TOP);
    expect(l[1]?.bottom).toBeCloseTo(PACK_TOP + 0.3);
  });

  test("heavy items placed high raise the centre of mass", () => {
    const low = loadStats(["kettle", "blanket", "biscuits"]);
    const high = loadStats(["biscuits", "blanket", "kettle"]);
    expect(high.mass).toBeCloseTo(low.mass);
    expect(high.comHeight).toBeGreaterThan(low.comHeight);
    expect(high.wobble).toBeGreaterThan(low.wobble);
  });

  test("more load walks slower", () => {
    expect(loadStats(["kettle", "chair", "lamp"]).maxSpeed).toBeLessThan(
      loadStats(["kettle"]).maxSpeed,
    );
  });

  test("the blanket makes whatever sits on it grippier", () => {
    const on = effectiveGrip(["blanket", "biscuits"], 1);
    const off = effectiveGrip(["kettle", "biscuits"], 1);
    expect(on).toBeGreaterThan(off);
  });
});

describe("balance", () => {
  test("a modest load settles back upright", () => {
    const stats = loadStats(["kettle", "teacups"]);
    let b = { ...restingBalance(), tilt: 0.2 };
    for (let i = 0; i < 600; i++) b = stepBalance(b, stats, { lean: 0, lateral: 0, torque: 0 }, DT);
    expect(Math.abs(b.tilt)).toBeLessThan(0.01);
  });

  test("leaning pushes the load the way you lean", () => {
    const stats = loadStats(["kettle"]);
    let b = restingBalance();
    for (let i = 0; i < 60; i++) b = stepBalance(b, stats, { lean: -1, lateral: 0, torque: 0 }, DT);
    expect(b.tilt).toBeLessThan(0);
  });

  test("cornering throws the load outward", () => {
    const stats = loadStats(["kettle", "lamp"]);
    let b = restingBalance();
    for (let i = 0; i < 30; i++) b = stepBalance(b, stats, { lean: 0, lateral: 2, torque: 0 }, DT);
    expect(b.tilt).toBeGreaterThan(0);
  });
});

describe("trail", () => {
  test("zones appear in order", () => {
    expect(zoneAt(1)).toBe("meadow");
    expect(zoneAt(20)).toBe("hairpin");
    expect(zoneAt(50)).toBe("logs");
    expect(zoneAt(80)).toBe("green");
    expect(zoneAt(120)).toBe("orchard");
    expect(zoneAt(150)).toBe("lane");
    expect(zoneAt(190)).toBe("ledge");
    expect(zoneAt(210)).toBe("lookout");
  });

  test("the ledge is less forgiving", () => {
    expect(toppleLimit(190)).toBeLessThan(toppleLimit(20));
  });

  test("the first hill's flank tips the load downhill unless you lean", () => {
    expect(camberAt(9)).toBeGreaterThan(0.2);
    expect(camberAt(30)).toBe(0);
    const s = createRun(["kettle", "blanket"]);
    startHike(s);
    s.d = 8;
    for (let t = 0; t < 1.5; t += DT) {
      stepRun(s, { walk: false, lean: 0 }, DT);
      s.d = 8;
    }
    expect(s.balance.tilt).toBeGreaterThan(0.02);
    const held = createRun(["kettle", "blanket"]);
    startHike(held);
    held.d = 8;
    for (let t = 0; t < 1.5; t += DT) {
      stepRun(held, { walk: false, lean: -0.6 }, DT);
      held.d = 8;
    }
    expect(Math.abs(held.balance.tilt)).toBeLessThan(s.balance.tilt);
  });

  test("gusts whistle before they push", () => {
    expect(gustAt(0.2)).toMatchObject({ warning: true, strength: 0 });
    expect(gustAt(2).strength).toBe(1);
  });

  test("checkpoints are the last one passed", () => {
    expect(lastCheckpoint(5)).toBe(0);
    expect(lastCheckpoint(50)).toBe(40);
    expect(lastCheckpoint(150)).toBe(132);
  });

  test("the path is continuous and the hairpin turns it around", () => {
    const path = samplePath();
    const a = pointAt(path, 16).heading;
    const b = pointAt(path, 28).heading;
    expect(b - a).toBeGreaterThan(2.5);
    for (let i = 1; i < path.length; i++) {
      const p = path[i - 1];
      const q = path[i];
      if (!p || !q) continue;
      expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeCloseTo(0.5, 3);
    }
  });
});

describe("the logs", () => {
  test("walking into a log trips the bear back to the last flag", () => {
    const s = createRun(["kettle", "blanket"]);
    startHike(s);
    const log = LOGS[0];
    if (!log) throw new Error("no logs");
    s.d = log.at - 1.5;
    s.checkpoint = { at: 40, stack: ["kettle", "blanket"] };
    const events = hike(
      s,
      (x) => ({ walk: true, lean: clampLean(-3 * x.balance.tilt), jump: false }),
      2,
    );
    expect(events.some((e) => e.type === "trip")).toBe(true);
    expect(s.d).toBe(40);
    expect(s.trips).toBe(1);
  });

  test("a well-timed jump clears a log and the landing jolts the load", () => {
    const s = createRun(["kettle", "blanket"]);
    startHike(s);
    const log = LOGS[0];
    if (!log) throw new Error("no logs");
    s.d = log.at - 3;
    s.speed = s.stats.maxSpeed;
    s.logsPassed = 0;
    const events = hike(s, steady, 3);
    expect(events.some((e) => e.type === "trip")).toBe(false);
    expect(events.some((e) => e.type === "log")).toBe(true);
    expect(events.some((e) => e.type === "land")).toBe(true);
  });
});

describe("the village green", () => {
  test("people follow their routes exactly, and crossers leave gaps", () => {
    for (const w of CROWD) {
      expect(walkerAt(w, 12.5)).toEqual(walkerAt(w, 12.5));
      if (w.behaviour !== "cross") continue;
      let onPath = 0;
      for (let t = 0; t < 60; t += 0.1) if (Math.abs(walkerAt(w, t).x) < 0.7) onPath++;
      expect(onPath / 600).toBeLessThan(0.3);
      expect(onPath).toBeGreaterThan(0);
    }
  });

  test("standing in a crosser's way gets you bumped", () => {
    const s = createRun(["kettle"]);
    startHike(s);
    const w = CROWD[0];
    if (!w) throw new Error("no crowd");
    let bumped = false;
    for (let t = 0; t < 40 && !bumped; t += DT) {
      s.d = walkerAt(w, s.time).d;
      stepRun(s, { walk: false, lean: 0 }, DT);
      bumped = drainEvents(s).some((e) => e.type === "bump");
    }
    expect(bumped).toBe(true);
    expect(s.bumps).toBeGreaterThan(0);
  });
});

describe("the orchard", () => {
  test("a tall upright stack loses its top to a branch; short stacks pass underneath", () => {
    const b = BRANCHES[0];
    if (!b) throw new Error("no branches");
    expect(branchCatches(b, 0.9, 0)).toBe(true);
    expect(branchCatches(b, 0.3, 0)).toBe(false);
  });

  test("leaning the stack away from the branch clears it", () => {
    const b = BRANCHES[0];
    if (!b) throw new Error("no branches");
    expect(branchCatches(b, 0.9, -b.side * 0.2)).toBe(false);
    expect(branchCatches(b, 0.9, b.side * 0.2)).toBe(true);
  });

  test("a branch that catches knocks the top item off", () => {
    const s = createRun(["kettle", "blanket", "teacups", "biscuits"]);
    startHike(s);
    const b = BRANCHES[0];
    if (!b) throw new Error("no branches");
    s.d = b.at - 0.05;
    s.logsPassed = LOGS.length;
    s.branchesPassed = 0;
    s.speed = 1;
    stepRun(s, { walk: true, lean: 0 }, DT * 6);
    const events = drainEvents(s);
    expect(events.some((e) => e.type === "branch" && e.hit === "biscuits")).toBe(true);
    expect(s.stack).toEqual(["kettle", "blanket", "teacups"]);
  });
});

describe("the goose", () => {
  test("it wakes at its lane and takes the biscuits from a bear that dawdles", () => {
    const g = sleepingGoose();
    const stack = ["kettle", "biscuits"] as ItemId[];
    expect(stepGoose(g, LANE.from, stack, DT, () => 0.5)).toEqual([]);
    const woke = stepGoose(g, GOOSE.wake + 0.1, stack, DT, () => 0.5);
    expect(woke.some((e) => e.type === "honk")).toBe(true);
    const events = [];
    for (let t = 0; t < 12; t += DT)
      events.push(...stepGoose(g, GOOSE.wake + 0.1, stack, DT, () => 0.5));
    expect(events.some((e) => e.type === "steal")).toBe(true);
    expect(stack).toEqual(["kettle"]);
    expect(events.some((e) => e.type === "peck")).toBe(true);
  });

  test("a bear that keeps walking outpaces it, and it gives up at the gate", () => {
    const g = sleepingGoose();
    const stack = ["kettle", "biscuits"] as ItemId[];
    const events = [];
    for (let d = GOOSE.wake; d < GOOSE.quit + 1; d += 1.7 * DT)
      events.push(...stepGoose(g, d, stack, DT, () => 0.5));
    expect(events.some((e) => e.type === "steal" || e.type === "peck")).toBe(false);
    expect(g.state).toBe("done");
    expect(stack).toEqual(["kettle", "biscuits"]);
  });
});

describe("packing", () => {
  test("toggle adds to the top and removes", () => {
    const s = createRun([]);
    togglePack(s, "kettle");
    togglePack(s, "lamp");
    expect(s.packed).toEqual(["kettle", "lamp"]);
    togglePack(s, "kettle");
    expect(s.packed).toEqual(["lamp"]);
  });

  test("items can be reordered", () => {
    const s = createRun(["kettle", "lamp", "biscuits"]);
    movePacked(s, 0, 1);
    expect(s.packed).toEqual(["lamp", "kettle", "biscuits"]);
    movePacked(s, 2, 1);
    expect(s.packed).toEqual(["lamp", "kettle", "biscuits"]);
  });

  test("packing is locked once hiking", () => {
    const s = createRun(["kettle"]);
    startHike(s);
    togglePack(s, "lamp");
    expect(s.stack).toEqual(["kettle"]);
  });
});

describe("the hike", () => {
  test("a sensible load, carried carefully, arrives intact", () => {
    const s = createRun(["kettle", "blanket", "teacups", "biscuits"]);
    startHike(s);
    const events = hike(s, careful, 600);
    expect(s.phase).toBe("tea");
    expect(s.stack).toEqual(["kettle", "blanket", "teacups", "biscuits"]);
    expect(events.some((e) => e.type === "arrive")).toBe(true);
    expect(events.filter((e) => e.type === "log")).toHaveLength(4);
    expect(events.filter((e) => e.type === "branch")).toHaveLength(BRANCHES.length);
    expect(s.trips).toBe(0);
    expect(s.bumps).toBe(0);
    expect(s.stolen).toEqual([]);
  });

  test("walking straight through without care costs something on the way", () => {
    const s = createRun(["kettle", "blanket", "teacups", "biscuits"]);
    startHike(s);
    hike(s, steady, 600);
    expect(s.phase).toBe("tea");
    expect(s.spills + s.bumps + s.stolen.length).toBeGreaterThan(0);
  });

  test("a top-heavy load with no leaning spills things", () => {
    const s = createRun(["lamp", "biscuits", "teacups", "blanket", "chair", "kettle"]);
    startHike(s);
    const events = hike(s, (x) => ({ walk: true, lean: 0, jump: jumpFor(x) }));
    expect(events.some((e) => e.type === "drop")).toBe(true);
    expect(s.dropped.length).toBeGreaterThan(0);
    expect(s.spills).toBe(events.filter((e) => e.type === "drop").length);
  });

  test("standing still does not move the bear", () => {
    const s = createRun(["kettle"]);
    startHike(s);
    hike(s, () => ({ walk: false, lean: 0 }), 5);
    expect(s.d).toBe(0);
  });

  test("dropped items can be fetched back at a modest time cost", () => {
    const s = createRun(["kettle", "biscuits"]);
    startHike(s);
    s.d = 30;
    s.stack = ["kettle"];
    s.dropped = [{ id: "biscuits", at: 20 }];
    const cost = fetchCost(s, { id: "biscuits", at: 20 });
    expect(cost).toBeGreaterThan(2);
    expect(cost).toBeLessThan(8);
    expect(fetchItem(s, "biscuits")).toBe(true);
    expect(s.fetches).toBe(1);
    expect(s.stack).toEqual(["kettle", "biscuits"]);
    expect(totalTime(s)).toBe(cost);
    expect(fetchItem(s, "biscuits")).toBe(false);
  });

  test("toppling returns to the checkpoint with the checkpoint load", () => {
    const s = createRun(["kettle", "biscuits"]);
    startHike(s);
    s.d = 45;
    s.checkpoint = { at: 40, stack: ["kettle", "biscuits"] };
    s.stack = ["kettle"];
    s.dropped = [{ id: "biscuits", at: 43 }];
    s.balance.tilt = 1.2;
    stepRun(s, { walk: false, lean: 0 }, DT);
    expect(s.d).toBe(40);
    expect(s.stack).toEqual(["kettle", "biscuits"]);
    expect(s.dropped).toHaveLength(0);
    expect(drainEvents(s).some((e) => e.type === "topple")).toBe(true);
    expect(s.busy).toBeGreaterThan(0);
  });

  test("the run ends at the lookout", () => {
    const s = createRun(["kettle"]);
    startHike(s);
    hike(s, steady, 600);
    expect(s.d).toBe(TRAIL_LENGTH);
    expect(s.phase).toBe("tea");
  });
});

describe("tea", () => {
  const all: ItemId[] = ["kettle", "chair", "blanket", "teacups", "biscuits", "lamp"];

  test("a minimalist hike makes a neat cup", () => {
    expect(teaOutcome(["kettle", "teacups"], ["kettle", "teacups"]).style).toBe("neat");
  });

  test("a ridiculous load that arrives becomes a lounge", () => {
    const o = teaOutcome(all, all);
    expect(o.style).toBe("lounge");
    expect(o.silence).toBe(false);
  });

  test("missing biscuits receive a moment of silence", () => {
    const o = teaOutcome(["kettle", "biscuits"], ["kettle"]);
    expect(o.silence).toBe(true);
    expect(o.lost).toEqual(["biscuits"]);
    expect(o.lines.at(-1)).toContain("silence");
  });

  test("nothing arriving still ends with dignity", () => {
    expect(teaOutcome(["kettle"], []).style).toBe("view");
  });

  test("civility counts what arrived", () => {
    expect(teaOutcome(all, ["kettle"]).civility).toBeLessThan(teaOutcome(all, all).civility);
  });
});
