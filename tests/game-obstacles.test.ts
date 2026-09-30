import { describe, expect, test } from "bun:test";
import { ITEM_ORDER, item } from "../src/game/items";
import { BRANCHES, branchCatches } from "../src/game/obstacles";
import { createRun, drainEvents, startHike, stepRun } from "../src/game/run";
import { MAX_CIVILITY, teaOutcome } from "../src/game/tea";

describe("orchard jump clearance", () => {
  test("a stack that fits under a bough on foot hits it while jumping", () => {
    const branch = { at: 110, side: 1, height: 1.48 };
    expect(branchCatches(branch, 0.46, 0)).toBe(false);
    expect(branchCatches(branch, 0.46, 0, 0.35)).toBe(true);
    expect(branchCatches(branch, 0.46, -0.2, 0.35)).toBe(false);
    expect(branchCatches(branch, 0, 0, 0.35)).toBe(false);
  });

  test("the run uses the bear's actual feet height at a branch", () => {
    const s = createRun(["kettle", "biscuits"]);
    startHike(s);
    const branch = BRANCHES[0];
    if (!branch) throw new Error("Expected the first authored branch");
    s.d = branch.at - 0.01;
    s.speed = s.stats.maxSpeed;
    s.y = 0.35;
    s.airborne = true;
    s.jumpHeld = true;
    stepRun(s, { walk: true, lean: 0, jump: true }, 1 / 120);
    expect(s.branchesPassed).toBe(1);
    expect(s.stack).toEqual(["kettle"]);
    expect(drainEvents(s)).toContainEqual({
      type: "branch",
      at: branch.at,
      side: branch.side,
      hit: "biscuits",
    });
  });
});

describe("tea reflects the actual load", () => {
  test("proper cups without a kettle serve water, not tea", () => {
    const cold = teaOutcome(["kettle", "teacups"], ["teacups"]);
    expect(cold.lines).toContain("No kettle. Cold stream water, served with optimism.");
    expect(cold.lines).toContain("Stream water is served in a proper cup.");
    expect(cold.lines).not.toContain("Tea is poured into a proper cup.");
    expect(teaOutcome(["kettle", "teacups"], ["kettle", "teacups"]).lines).toContain(
      "Tea is poured into a proper cup.",
    );
  });

  test("all attainable arrival subsets tally only what survived", () => {
    for (let mask = 0; mask < 1 << ITEM_ORDER.length; mask++) {
      const arrived = ITEM_ORDER.filter((_, i) => mask & (1 << i));
      const outcome = teaOutcome(ITEM_ORDER, arrived);
      expect(outcome.arrived).toEqual(arrived);
      expect(outcome.lost).toEqual(ITEM_ORDER.filter((id) => !arrived.includes(id)));
      expect(outcome.civility).toBe(arrived.reduce((sum, id) => sum + item(id).comfort, 0));
      expect(outcome.civility).toBeLessThanOrEqual(MAX_CIVILITY);
      expect(outcome.silence).toBe(!arrived.includes("biscuits"));
      expect(outcome.lines.includes("Tea is poured into a proper cup.")).toBe(
        arrived.includes("kettle") && arrived.includes("teacups"),
      );
      expect(outcome.lines.includes("A moment of silence for the biscuits.")).toBe(outcome.silence);
    }
  });
});
