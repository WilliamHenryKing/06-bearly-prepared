import { describe, expect, test } from "bun:test";
import { restingBalance } from "../src/game/balance";
import type { ItemId } from "../src/game/items";
import { loadStats } from "../src/game/load";
import {
  createRun,
  drainEvents,
  fetchItem,
  type RunState,
  startHike,
  stepRun,
} from "../src/game/run";

const DT = 1 / 120;
const idle = { walk: false, lean: 0, jump: false };

function recover(s: RunState, jump = false) {
  while (s.busy > 0) stepRun(s, { ...idle, jump }, DT);
}

function expectInventory(s: RunState) {
  const held = [...s.stack, ...s.dropped.map((drop) => drop.id), ...s.stolen].sort();
  expect(held).toEqual([...s.packed].sort());
  expect(new Set(held).size).toBe(held.length);
  expect(s.stats).toEqual(loadStats(s.stack));
  expect(s.slides.length).toBe(s.stack.length);
}

/** Spill before a flag, cross it with a smaller load, then fetch the missing item. */
function fetchedAfterFlag() {
  const s = createRun(["kettle", "biscuits"]);
  startHike(s);
  s.d = 38.9;
  s.balance.tilt = 0.4;
  s.slides[1] = 0.999;
  stepRun(s, idle, DT);
  expect(s.stack).toEqual(["kettle"]);
  expect(s.dropped.map((drop) => drop.id)).toEqual(["biscuits"]);

  s.balance = restingBalance();
  s.d = 39.99;
  s.speed = s.stats.maxSpeed;
  stepRun(s, { ...idle, walk: true }, DT);
  expect(s.checkpoint).toEqual({ at: 40, stack: ["kettle"] });
  expect(fetchItem(s, "biscuits")).toBe(true);
  recover(s);
  expect(s.stack).toEqual(["kettle", "biscuits"]);
  drainEvents(s);
  return s;
}

describe("checkpoint recovery", () => {
  for (const fall of ["topple", "trip"] as const) {
    test(`an item fetched after a flag stays recoverable after a ${fall}`, () => {
      const s = fetchedAfterFlag();
      s.d = fall === "trip" ? 46.8 : 44;
      s.speed = s.stats.maxSpeed;
      if (fall === "topple") s.balance.tilt = 1.1;
      stepRun(s, { ...idle, walk: true }, DT);

      expect(s.d).toBe(40);
      expect(s.stack).toEqual(["kettle"]);
      expect(s.dropped.map((drop) => drop.id)).toEqual(["biscuits"]);
      expect(s.dropped[0]?.at).toBeGreaterThan(40);
      expect(drainEvents(s)).toContainEqual({ type: "drop", id: "biscuits", side: 1 });
      expectInventory(s);

      recover(s);
      expect(fetchItem(s, "biscuits")).toBe(true);
      expect(s.stack).toEqual(["kettle", "biscuits"]);
      expect(s.fetches).toBe(2);
      expectInventory(s);
    });
  }

  test("a flag's original load restores once even if its item has since been fetched", () => {
    const s = createRun(["kettle", "biscuits"]);
    startHike(s);
    s.d = 4;
    s.balance.tilt = 0.4;
    s.slides[1] = 0.999;
    stepRun(s, idle, DT);
    expect(fetchItem(s, "biscuits")).toBe(true);
    recover(s);
    s.balance.tilt = 1.1;
    stepRun(s, idle, DT);
    expect(s.stack).toEqual(["kettle", "biscuits"]);
    expect(s.dropped).toEqual([]);
    expectInventory(s);
  });

  for (const saveAfterTheft of [false, true]) {
    test(`a flag ${saveAfterTheft ? "after" : "before"} goose theft preserves its saved load`, () => {
      const s = createRun(["kettle", "biscuits"]);
      startHike(s);
      s.checkpoint = { at: 132, stack: [...s.stack] };
      s.d = 150;
      s.goose = { state: "chasing", d: 149.5, speed: 1.32, peckIn: 0 };
      stepRun(s, idle, DT);
      expect(s.stolen).toEqual(["biscuits"]);
      expect(fetchItem(s, "biscuits")).toBe(false);
      expectInventory(s);
      if (saveAfterTheft) {
        s.d = 169.99;
        s.speed = s.stats.maxSpeed;
        stepRun(s, { ...idle, walk: true }, DT);
        expect(s.checkpoint).toEqual({ at: 170, stack: ["kettle"] });
      }
      s.balance.tilt = 1.1;
      stepRun(s, idle, DT);
      expect(s.stack).toEqual(saveAfterTheft ? ["kettle"] : ["kettle", "biscuits"]);
      expect(s.stolen).toEqual(saveAfterTheft ? ["biscuits"] : []);
      expect(s.goose.state).toBe(saveAfterTheft ? "done" : "asleep");
      expect(s.dropped).toEqual([]);
      expectInventory(s);
    });
  }

  test("fetching in mid-air leaves the jump and inventory untouched", () => {
    const s = fetchedAfterFlag();
    s.balance.tilt = 0.4;
    s.slides[1] = 0.999;
    stepRun(s, idle, DT);
    expect(s.dropped.map((drop) => drop.id)).toEqual(["biscuits"]);
    s.balance = restingBalance();
    stepRun(s, { ...idle, jump: true }, DT);
    expect(s.airborne).toBe(true);
    const before = structuredClone(s);
    expect(fetchItem(s, "biscuits")).toBe(false);
    expect(s).toEqual(before);
    expectInventory(s);
  });

  test("a jump held during recovery does not fire when recovery ends", () => {
    const s = createRun([]);
    startHike(s);
    s.balance.tilt = 1.1;
    stepRun(s, idle, DT);
    drainEvents(s);
    recover(s, true);
    stepRun(s, { ...idle, jump: true }, DT);
    expect(s.airborne).toBe(false);
    expect(drainEvents(s)).toEqual([]);

    stepRun(s, idle, DT);
    stepRun(s, { ...idle, jump: true }, DT);
    expect(s.airborne).toBe(true);
    expect(drainEvents(s)).toContainEqual({ type: "jump" });
  });

  test("releasing jump during recovery permits the next fresh press", () => {
    const s = createRun([]);
    startHike(s);
    stepRun(s, { ...idle, jump: true }, DT);
    s.balance.tilt = 1.1;
    stepRun(s, { ...idle, jump: true }, DT);
    expect(s.busy).toBeGreaterThan(0);
    drainEvents(s);
    recover(s);
    stepRun(s, { ...idle, jump: true }, DT);
    expect(s.airborne).toBe(true);
    expect(drainEvents(s)).toContainEqual({ type: "jump" });
  });

  test("starting twice cannot erase an active or completed hike", () => {
    const packed: ItemId[] = ["kettle", "biscuits"];
    const s = createRun(packed);
    startHike(s);
    for (let i = 0; i < 120; i++) stepRun(s, { ...idle, walk: true }, DT);
    const active = structuredClone(s);
    startHike(s);
    expect(s).toEqual(active);
    s.phase = "tea";
    const complete = structuredClone(s);
    startHike(s);
    expect(s).toEqual(complete);
  });
});
