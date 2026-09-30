import { describe, expect, test } from "bun:test";
import { createRun, type Input, startHike } from "../src/game/run";
import { LOGS } from "../src/game/trail";
import { startGuide, stepGuide } from "../src/ui/guideProgress";
import { guideText } from "../src/ui/Opening";
import { snapshot } from "../src/ui/store";

const idle: Input = { walk: false, lean: 0, jump: false };
const hike = () => {
  const run = createRun();
  startHike(run);
  return run;
};

describe("a guide advances from demonstrated actions", () => {
  test("idle waiting never completes walking", () => {
    const run = hike();
    let guide = startGuide(run);
    for (let i = 0; i < 200; i++) guide = stepGuide(guide, run, idle, 0.1);
    expect(guide.step).toBe(0);
    run.d = 2.6;
    expect(stepGuide(guide, run, idle, 0.1).step).toBe(1);
  });
  test("leaning with the sway cannot substitute for opposing the loaded stack", () => {
    const run = hike();
    run.balance.tilt = 0.2;
    let guide = startGuide(run, 1);
    for (let i = 0; i < 200; i++) guide = stepGuide(guide, run, { ...idle, lean: 1 }, 0.1);
    expect(guide.step).toBe(1);
    expect(guide.leanSeconds).toBe(0);
    for (let i = 0; i < 6 && guide.step === 1; i++)
      guide = stepGuide(guide, run, { ...idle, lean: -1 }, 0.1);
    expect(guide.step).toBe(2);
  });
  test("settling requires an actual stop, a safe tilt and settled pieces", () => {
    const run = hike();
    let guide = startGuide(run, 2);
    run.speed = 0.5;
    for (let i = 0; i < 10; i++) guide = stepGuide(guide, run, idle, 0.1);
    expect(guide.step).toBe(2);
    run.speed = 0;
    run.slides[0] = 0.5;
    for (let i = 0; i < 10; i++) guide = stepGuide(guide, run, idle, 0.1);
    expect(guide.step).toBe(2);
    run.slides.fill(0);
    for (let i = 0; i < 8 && guide.step === 2; i++) guide = stepGuide(guide, run, idle, 0.1);
    expect(guide.step).toBe(3);
  });
  test("a trip is another attempt, and only an observed clean jump finishes", () => {
    const run = hike();
    let guide = startGuide(run, 3);
    run.airborne = true;
    guide = stepGuide(guide, run, { ...idle, jump: true }, 0.1);
    run.logsPassed++;
    run.trips++;
    run.airborne = false;
    guide = stepGuide(guide, run, idle, 0.1);
    expect(guide.step).toBe(3);
    expect(guide.jumped).toBe(false);
    run.airborne = true;
    guide = stepGuide(guide, run, { ...idle, jump: true }, 0.1);
    run.logsPassed++;
    run.airborne = false;
    expect(stepGuide(guide, run, idle, 0.1).step).toBe(-1);
  });
  test("replaying beyond the logs practices a real jump and landing", () => {
    const run = hike();
    run.d = 120;
    run.logsPassed = LOGS.length;
    let guide = startGuide(run, 3);
    expect(guideText(3, snapshot(run, null, 3, "done"))?.more).toContain("logs are behind you");
    for (let i = 0; i < 30; i++) guide = stepGuide(guide, run, idle, 0.1);
    expect(guide.step).toBe(3);
    run.airborne = true;
    guide = stepGuide(guide, run, { ...idle, jump: true }, 0.1);
    expect(guide.step).toBe(3);
    run.airborne = false;
    expect(stepGuide(guide, run, idle, 0.1).step).toBe(-1);
  });
  test("Goose Lane teaches safe movement rather than asking the player to stop", () => {
    const run = hike();
    run.d = 140;
    let guide = startGuide(run, 2);
    expect(guideText(2, snapshot(run, null, 2, "done"))?.lead).toContain("Keep moving");
    for (let i = 0; i < 10; i++) guide = stepGuide(guide, run, idle, 0.1);
    expect(guide.step).toBe(2);
    for (let i = 0; i < 8 && guide.step === 2; i++)
      guide = stepGuide(guide, run, { ...idle, walk: true }, 0.1);
    expect(guide.step).toBe(3);
  });
  test("empty-pack replay has truthful balance copy and is still practicable", () => {
    const run = createRun([]);
    startHike(run);
    let guide = startGuide(run, 1);
    expect(guideText(1, snapshot(run, null, 1, "done"))?.more).toContain("pack is empty");
    for (let i = 0; i < 6 && guide.step === 1; i++)
      guide = stepGuide(guide, run, { ...idle, lean: 1 }, 0.1);
    expect(guide.step).toBe(2);
  });
});
