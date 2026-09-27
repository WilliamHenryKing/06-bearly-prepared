import { describe, expect, test } from "bun:test";
import { restingBalance, stepBalance } from "../src/game/balance";
import type { ItemId } from "../src/game/items";
import { effectiveGrip, layoutStack, loadStats, PACK_TOP } from "../src/game/load";
import {
  createRun,
  drainEvents,
  fetchCost,
  fetchItem,
  type Input,
  movePacked,
  type RunState,
  startHike,
  stepRun,
  togglePack,
  totalTime,
} from "../src/game/run";
import { teaOutcome } from "../src/game/tea";
import {
  gustAt,
  lastCheckpoint,
  pointAt,
  samplePath,
  TRAIL_LENGTH,
  toppleLimit,
  zoneAt,
} from "../src/game/trail";

const DT = 1 / 60;
const steady = (s: RunState): Input => ({
  walk: true,
  lean: Math.max(-1, Math.min(1, -(3 * s.balance.tilt + 0.9 * s.balance.spin))),
});

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
    expect(zoneAt(80)).toBe("ledge");
    expect(zoneAt(105)).toBe("lookout");
  });

  test("the ledge is less forgiving", () => {
    expect(toppleLimit(80)).toBeLessThan(toppleLimit(20));
  });

  test("gusts whistle before they push", () => {
    expect(gustAt(0.2)).toMatchObject({ warning: true, strength: 0 });
    expect(gustAt(2).strength).toBe(1);
  });

  test("checkpoints are the last one passed", () => {
    expect(lastCheckpoint(5)).toBe(0);
    expect(lastCheckpoint(50)).toBe(40);
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
  test("a sensible load with steady leaning arrives intact", () => {
    const s = createRun(["kettle", "blanket", "teacups", "biscuits"]);
    startHike(s);
    const events = hike(s, steady);
    expect(s.phase).toBe("tea");
    expect(s.stack).toEqual(["kettle", "blanket", "teacups", "biscuits"]);
    expect(events.some((e) => e.type === "arrive")).toBe(true);
    expect(events.filter((e) => e.type === "log")).toHaveLength(4);
  });

  test("a top-heavy load with no leaning spills things", () => {
    const s = createRun(["lamp", "biscuits", "teacups", "blanket", "chair", "kettle"]);
    startHike(s);
    const events = hike(s, () => ({ walk: true, lean: 0 }));
    expect(events.some((e) => e.type === "drop")).toBe(true);
    expect(s.dropped.length).toBeGreaterThan(0);
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
    hike(s, steady);
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
